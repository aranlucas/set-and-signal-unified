import { createHash, hkdfSync, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { CompactEncrypt, compactDecrypt } from "jose";
import { Webhook } from "standardwebhooks";
import { ProtocolError } from "@modelcontextprotocol/server";
import { z } from "zod";
import { readBounded } from "../garmin";
import { eventCodes } from "./protocol";

export function callbackUrl(value: string): string {
  const url = URL.parse(value);
  const host = url?.hostname.replaceAll(/^\[|\]$/g, "").replace(/\.$/, "") ?? "";

  if (
    url?.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !host.includes(".") ||
    isIP(host) ||
    /(^|\.)(localhost|local|internal|invalid|test)$/.test(host)
  ) {
    throw new ProtocolError(
      eventCodes.invalid,
      "Callback requires a public HTTPS hostname without credentials or fragment.",
    );
  }

  return url.href;
}

export function validWebhookSecret(value: string): boolean {
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }

  const bytes = Buffer.from(value.slice(6), "base64");

  return bytes.length >= 24 && bytes.length <= 64 && bytes.toString("base64") === value.slice(6);
}

function encryptionKey(master: string) {
  return new Uint8Array(hkdfSync("sha256", master, "garmin-mcp-events", "webhook-secrets-v1", 32));
}

export function sealSecret(secret: string, master: string): Promise<string> {
  return new CompactEncrypt(new TextEncoder().encode(secret))
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .encrypt(encryptionKey(master));
}

export async function openSecret(sealed: string, master: string): Promise<string | null> {
  try {
    const { plaintext } = await compactDecrypt(sealed, encryptionKey(master), {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });

    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

/** Native global fetch has public Internet routing enforced by global_fetch_strictly_public.
 * Never replace it with a service/VPC binding or enable private-origin routing.
 */
export function postWebhook(
  url: string,
  id: string,
  subscription: string,
  secrets: string[],
  body: string,
): Promise<Response> {
  const signedAt = new Date();

  return fetch(callbackUrl(url), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "Content-Type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(Math.floor(signedAt.getTime() / 1000)),
      "webhook-signature": secrets
        .map((secret) => new Webhook(secret).sign(id, signedAt, body))
        .join(" "),
      "X-MCP-Subscription-Id": subscription,
    },
    body,
  });
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

export async function verifyCallback(
  url: string,
  subscription: string,
  secret: string,
): Promise<void> {
  const challenge = crypto.randomUUID();

  try {
    const response = await postWebhook(
      url,
      `verify_${crypto.randomUUID()}`,
      subscription,
      [secret],
      JSON.stringify({ type: "verification", challenge }),
    );

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Rejected callback");
    }

    const bytes = await readBounded(response, 4096);

    const echoed = z
      .object({ challenge: z.string().max(512) })
      .parse(JSON.parse(new TextDecoder().decode(bytes))).challenge;

    if (!timingSafeEqual(digest(echoed), digest(challenge))) {
      throw new Error("Invalid challenge");
    }
  } catch {
    throw new ProtocolError(eventCodes.callback, "Callback endpoint verification failed.", {
      reason: "challenge_failed",
    });
  }
}
