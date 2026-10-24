import { afterEach, expect, it, vi } from "vitest";
import { Webhook } from "standardwebhooks";
import { z } from "zod";
import { MAX_EVENT_BYTES, postWebhook, verifyCallback } from "../src/events/webhook";

const secret = `whsec_${Buffer.alloc(32, 5).toString("base64")}`;

const callback = "https://callback.example.com/events";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("signs the exact serialized body and rejects altered signatures at the receiving boundary", async () => {
  const body = JSON.stringify({
    eventId: "evt-1",
    name: "garmin.activity.completed",
    timestamp: new Date().toISOString(),
    data: { activityName: "走る 🏃" },
    cursor: null,
  });

  const receiver = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
    const headers = Object.fromEntries(new Headers(init?.headers));
    expect(init?.body).toBe(body);
    expect(init?.redirect).toBe("error");
    expect(headers["webhook-id"]).toBe("evt-1");
    expect(headers["x-mcp-subscription-id"]).toBe("sub-1");
    expect(new Webhook(secret).verify(body, headers)).toMatchObject({ eventId: "evt-1" });
    expect(() => new Webhook(secret).verify(body + " ", headers)).toThrow(/signature/i);

    return Promise.resolve(new Response(null, { status: 200 }));
  });

  vi.stubGlobal("fetch", receiver);
  expect((await postWebhook(callback, "evt-1", "sub-1", [secret], body)).status).toBe(200);
});

it("enforces the complete UTF-8 body limit before any callback request", () => {
  const receiver = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", receiver);
  // Each character has three UTF-8 bytes, so a character-count limit would be unsafe.
  expect(() =>
    postWebhook(callback, "evt-1", "sub-1", [secret], "界".repeat(Math.ceil(MAX_EVENT_BYTES / 3))),
  ).toThrow("256 KiB");
  expect(receiver).not.toHaveBeenCalled();
});

it("preserves event identity and body while signing each retry with the current time", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
  const receiver = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", receiver);
  const body = JSON.stringify({ eventId: "evt-retry", data: {} });
  await postWebhook(callback, "evt-retry", "sub-1", [secret], body);
  vi.setSystemTime(new Date("2026-10-24T12:00:05Z"));
  await postWebhook(callback, "evt-retry", "sub-1", [secret], body);
  const first = new Headers(receiver.mock.calls[0]?.[1]?.headers);
  const retry = new Headers(receiver.mock.calls[1]?.[1]?.headers);
  expect(first.get("webhook-id")).toBe(retry.get("webhook-id"));
  expect(first.get("webhook-timestamp")).not.toBe(retry.get("webhook-timestamp"));
  expect(first.get("webhook-signature")).not.toBe(retry.get("webhook-signature"));
  expect(receiver.mock.calls[0]?.[1]?.body).toBe(receiver.mock.calls[1]?.[1]?.body);
});

it.each([
  { status: 400, reason: "http_4xx" },
  { status: 503, reason: "http_5xx" },
])(
  "categorizes callback verification HTTP $status without exposing its response",
  async ({ status, reason }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("private-upstream-detail", { status }))),
    );
    await expect(verifyCallback(callback, "sub-1", secret)).rejects.toMatchObject({
      code: -32015,
      data: { reason },
    });
  },
);

it.each([
  { failure: new DOMException("private-timeout-detail", "TimeoutError"), reason: "timeout" },
  { failure: new TypeError("private-network-detail"), reason: "connection_refused" },
  { failure: new Error("TLS certificate failure at private-location"), reason: "tls_error" },
])("categorizes $reason verification failures", async ({ failure, reason }) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(failure)),
  );
  await expect(verifyCallback(callback, "sub-1", secret)).rejects.toMatchObject({
    code: -32015,
    data: { reason },
  });
});

it("verifies a fresh signed challenge and rejects malformed callback echoes", async () => {
  const challenges: string[] = [];
  const verificationIds: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      const body = z.string().parse(init?.body);
      const headers = Object.fromEntries(new Headers(init?.headers));
      verificationIds.push(z.string().parse(headers["webhook-id"]));

      const request = z
        .object({ type: z.literal("verification"), challenge: z.string() })
        .parse(new Webhook(secret).verify(body, headers));

      challenges.push(request.challenge);

      return Promise.resolve(Response.json({ challenge: request.challenge }));
    }),
  );
  await verifyCallback(callback, "sub-1", secret);
  await verifyCallback(callback, "sub-1", secret);
  expect(new Set(challenges).size).toBe(2);
  expect(new Set(verificationIds).size).toBe(2);
  expect(verificationIds.every((id) => id.startsWith("msg_verification_"))).toBe(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({ challenge: "wrong" }))),
  );
  await expect(verifyCallback(callback, "sub-1", secret)).rejects.toMatchObject({
    code: -32015,
    data: { reason: "challenge_failed" },
  });
});
