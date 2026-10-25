import { readFile, writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { z } from "zod";
import { required } from "./support";

// Explicit project only. Uses an isolated synthetic Garmin ID and always purges its store.
it("accepts authenticated production push deliveries and cleans the isolated fixture", async () => {
  const secretPath = required(
    process.env.GARMIN_E2E_PUSH_SECRET_FILE,
    "GARMIN_E2E_PUSH_SECRET_FILE",
  );

  const { GARMIN_PUSH_TOKEN: credential } = z
    .object({ GARMIN_PUSH_TOKEN: z.string().regex(/^[a-f0-9]{64}$/) })
    .parse(JSON.parse(await readFile(secretPath, "utf8")));

  const base = process.env.SMOKE_BASE_URL ?? "https://garmin-mcp.aranlucas.workers.dev";
  const id = `MCP-E2E-${crypto.randomUUID()}`;

  const summary = {
    userId: id,
    summaryId: "synthetic-production-push",
    calendarDate: new Date().toISOString().slice(0, 10),
    startTimeInSeconds: Math.floor(Date.now() / 1000),
    durationInSeconds: 60,
    steps: 0,
  };

  const post = (token: string, body: string) =>
    fetch(`${base}/webhook/garmin/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "error",
      body,
    });

  const body = JSON.stringify({ dailies: [summary] });

  try {
    expect((await post("invalid-fixture-credential", body)).status).toBe(404);
    expect((await post(credential, body)).status).toBe(200);
    expect((await post(credential, body)).status).toBe(200);
    expect((await post(credential, JSON.stringify({ unknown: [] }))).status).toBe(400);
  } finally {
    const deleted = await fetch(`${base}/garmin/disconnect`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      redirect: "error",
      body: JSON.stringify({ userId: id }),
    });

    expect(deleted.status).toBe(204);
    await writeFile(
      `${secretPath}.records.json`,
      JSON.stringify({ syntheticUserId: id, cleanupComplete: true }),
      { mode: 0o600 },
    );
  }
});
