import { describe, expect, it } from "vitest";
import {
  GARMIN_BASE,
  GARMIN_TOKEN_PATH,
  GarminClient,
  obtainToken,
  readBounded,
} from "../src/garmin";
import { requestUrl } from "./support";

const apiKey = "test-only-personal-api-key-never-real";

const tokenResponse = (): Promise<Response> =>
  Promise.resolve(Response.json({ access_token: "tok" }));

const unrecognizedToken = (): Promise<Response> =>
  Promise.resolve(Response.json({ unrecognized: "not a token" }));

const rateLimited = (): Promise<Response> =>
  Promise.resolve(new Response("secret body", { status: 429 }));

const unreachable = (): Promise<Response> => Promise.reject(new TypeError("network down"));

describe("Garmin boundaries", () => {
  it("bounds streamed responses and rejects malformed token payloads", async () => {
    await expect(readBounded(new Response("too large"), 3)).rejects.toThrow("too large");
    await expect(obtainToken(apiKey, unrecognizedToken)).rejects.toThrow("unrecognized");
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

    expect(await client.get("/download-service/files/activity/1", true)).toEqual(file);
    expect(await client.get("/download-service/files/activity/2", true)).toEqual(file);
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
