import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  GARMIN_BASE,
  GARMIN_TOKEN_PATH,
  GarminClient,
  obtainToken,
  readBounded,
  type GarminJson,
} from "../src/garmin";
import { zUserDailySummaryDto } from "../src/garmin-api/zod.gen";
import { requestUrl, required } from "./support";

const apiKey = "test-only-personal-api-key-never-real";

const tokenResponse = (): Promise<Response> =>
  Promise.resolve(Response.json({ access_token: "tok" }));

const unrecognizedToken = (): Promise<Response> =>
  Promise.resolve(Response.json({ unrecognized: "not a token" }));

const rateLimited = (): Promise<Response> =>
  Promise.resolve(new Response("secret body", { status: 429 }));

const unreachable = (): Promise<Response> => Promise.reject(new TypeError("network down"));

function jsonFetcher(data: GarminJson): typeof fetch {
  return (input) =>
    requestUrl(input).endsWith(GARMIN_TOKEN_PATH)
      ? tokenResponse()
      : Promise.resolve(Response.json(data));
}

describe("Garmin boundaries", () => {
  it("bounds streamed responses and rejects malformed token payloads", async () => {
    await expect(readBounded(new Response("too large"), 3)).rejects.toThrow("too large");
    await expect(obtainToken(apiKey, unrecognizedToken)).rejects.toThrow("unrecognized");
  });

  it("infers the response type from its schema and preserves new Garmin fields", async () => {
    const data = { totalSteps: 1234, futureMetric: { value: 42 } };
    const client = new GarminClient(apiKey, jsonFetcher(data));

    const summary = await client.get(
      zUserDailySummaryDto,
      "/usersummary-service/usersummary/daily",
    );

    expectTypeOf(summary.totalSteps).toEqualTypeOf<number | undefined>();
    expect(summary).toEqual(data);
  });

  it("rejects malformed health responses without leaking values from validation errors", async () => {
    const client = new GarminClient(apiKey, jsonFetcher({ totalSteps: "private health value" }));
    const request = client.get(zUserDailySummaryDto, "/usersummary-service/usersummary/daily");

    await expect(request).rejects.toThrow("published API schema");
    await expect(request).rejects.not.toThrow("private health value");
  });

  it.each([
    { access_token: "" },
    { access_token: "with spaces" },
    { accessToken: "header\r\ninjection" },
    { access_token: 123 },
  ])("rejects invalid token credentials: %j", async (data) => {
    await expect(obtainToken(apiKey, () => Promise.resolve(Response.json(data)))).rejects.toThrow(
      "unrecognized token response",
    );
  });

  it("cancels oversized response streams", async () => {
    const cancel = vi.fn();

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4));
      },
      cancel,
    });

    await expect(readBounded(new Response(stream), 3)).rejects.toThrow("too large");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("propagates cancellation to both Garmin token and data requests", async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];

    const fetcher: typeof fetch = (input, init) => {
      const signal = required(init?.signal, "outbound abort signal");
      signals.push(signal);

      if (requestUrl(input).endsWith(GARMIN_TOKEN_PATH)) {
        return tokenResponse();
      }

      controller.abort();

      return Promise.reject(new DOMException("cancelled", "AbortError"));
    };

    const client = new GarminClient(apiKey, fetcher);

    await expect(client.get(zUserDailySummaryDto, "/summary", controller.signal)).rejects.toThrow(
      "cancelled",
    );
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
  it("returns activity files as base64 and reuses one Garmin token per request", async () => {
    const calls: string[] = [];

    const accepts: (string | null)[] = [];

    const mock: typeof fetch = (input, init) => {
      const url = requestUrl(input);

      calls.push(`${init?.method ?? "GET"} ${url.slice(GARMIN_BASE.length)}`);

      if (url.endsWith(GARMIN_TOKEN_PATH)) {
        return tokenResponse();
      }

      accepts.push(new Headers(init?.headers).get("accept"));

      return Promise.resolve(
        new Response(new Uint8Array([0, 1, 2, 255]), {
          headers: { "Content-Type": "application/zip" },
        }),
      );
    };

    const client = new GarminClient(apiKey, mock);

    const file = {
      source: "Garmin Connect",
      encoding: "base64",
      contentType: "application/zip",
      data: "AAEC/w==",
    };

    expect(await client.download("/download-service/files/activity/1")).toEqual(file);
    expect(await client.download("/download-service/files/activity/2")).toEqual(file);
    expect(calls).toEqual([
      `POST ${GARMIN_TOKEN_PATH}`,
      "GET /download-service/files/activity/1",
      "GET /download-service/files/activity/2",
    ]);
    expect(accepts).toEqual(["application/octet-stream", "application/octet-stream"]);
  });
  it("maps upstream failures to safe messages without echoing bodies", async () => {
    await expect(obtainToken(apiKey, rateLimited)).rejects.toThrow("rate limit");
    await expect(obtainToken(apiKey, unreachable)).rejects.toThrow("could not be reached");
  });
});
