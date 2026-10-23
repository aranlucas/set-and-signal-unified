import { readFile, writeFile } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";
import * as z from "zod";
import {
  workoutResponse,
  scheduleResponse,
  schedulesResponse,
  mutationAccepted,
  trainingId,
} from "../src/training/schemas";
import { required } from "./support";

// Explicit project only. This test writes disposable synthetic workouts to the consenting account.
// The private session file is prepared through the real browser OAuth flow, outside the repository.
const sessionSchema = z.object({
  base: z.url(),
  issuer: z.url(),
  clientId: z.string().min(1),
  refreshToken: z.string().min(1),
});

const authorizationMetadata = z.object({ revocation_endpoint: z.url() });

const refreshedTokens = z.object({ access_token: z.string(), refresh_token: z.string() });

const workoutResult = z.object({ data: workoutResponse });

const scheduleResult = z.object({ data: scheduleResponse });

const scheduleListResult = z.object({ data: schedulesResponse });

async function cleanup(
  client: Client,
  workoutId: number | undefined,
  scheduleId: number | undefined,
  date: string,
  endDate: string,
): Promise<void> {
  const failures: string[] = [];

  if (scheduleId !== undefined) {
    try {
      const result = await client.callTool({
        name: "delete_workout_schedule",
        arguments: { scheduleId },
      });

      if (result.isError) {
        failures.push(`calendar entry ${scheduleId}`);
      }
    } catch {
      failures.push(`calendar entry ${scheduleId}`);
    }
  }

  if (workoutId !== undefined) {
    try {
      const result = await client.callTool({ name: "delete_workout", arguments: { workoutId } });

      if (result.isError) {
        failures.push(`workout ${workoutId}`);
      }
    } catch {
      failures.push(`workout ${workoutId}`);
    }
  }

  if (workoutId !== undefined) {
    try {
      const result = await client.callTool({
        name: "list_workout_schedules",
        arguments: { startDate: date, endDate },
      });

      const remaining = scheduleListResult.parse(result.structuredContent).data;

      if (remaining.some((item) => item.workoutId === workoutId)) {
        failures.push(`calendar entry for workout ${workoutId}`);
      }
    } catch {
      failures.push("calendar cleanup could not be verified");
    }
  }

  await client.close();
  expect(failures, "Disposable records requiring manual cleanup").toEqual([]);
}

it("verifies live OAuth refresh and the complete Garmin workout/calendar lifecycle over MCP HTTP", async () => {
  const sessionPath = required(process.env.GARMIN_E2E_SESSION_FILE, "GARMIN_E2E_SESSION_FILE");
  const session = sessionSchema.parse(JSON.parse(await readFile(sessionPath, "utf8")));
  const resource = `${session.base}/mcp`;

  const tokenResponse = await fetch(`${session.issuer}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    redirect: "error",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: session.clientId,
      refresh_token: session.refreshToken,
      resource,
    }),
  });

  expect(tokenResponse.status).toBe(200);
  const tokens = refreshedTokens.parse(await tokenResponse.json());
  await writeFile(sessionPath, JSON.stringify({ ...session, refreshToken: tokens.refresh_token }), {
    mode: 0o600,
  });

  const client = new Client({ name: "garmin-live-e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    }),
  );
  const tomorrow = new Date(Date.now() + 86_400_000);
  const dayAfter = new Date(Date.now() + 2 * 86_400_000);

  const calendar = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const date = calendar.format(tomorrow);
  const movedDate = calendar.format(dayAfter);
  const name = `MCP E2E ${crypto.randomUUID().slice(0, 8)}`;

  const workout = {
    workoutName: name,
    sport: "RUNNING",
    workoutProvider: "Garmin MCP",
    workoutSourceId: "Garmin MCP",
    segments: [
      {
        segmentOrder: 1,
        sport: "RUNNING",
        steps: [
          {
            type: "WorkoutStep",
            stepOrder: 1,
            intensity: "ACTIVE",
            durationType: "TIME",
            durationValue: 60,
            targetType: "OPEN",
          },
        ],
      },
    ],
  };

  let workoutId: number | undefined;
  let scheduleId: number | undefined;

  try {
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(12);

    const readSchema = z.object({
      data: z.object({
        records: z.array(z.object({ summary: z.object({ summaryId: z.string() }) })),
        hasMore: z.boolean(),
      }),
    });

    const today = new Date().toISOString().slice(0, 10);

    // A successful empty result is valid on Starter: only post-link push data can be read.
    await Promise.all(
      ["dailies", "activities"].map(async (type) => {
        const received = await client.callTool({
          name: "list_garmin_summaries",
          arguments: { type, startDate: today, endDate: today },
        });

        expect(received.isError).not.toBe(true);
        const rows = readSchema.parse(received.structuredContent).data.records;

        // The get path is exercised only when Garmin has delivered a record; mocked tests require records.
        await Promise.all(
          rows.slice(0, 1).map(async (row) => {
            const detail = await client.callTool({
              name: "get_garmin_summary",
              arguments: { type, summaryId: row.summary.summaryId },
            });

            expect(detail.isError).not.toBe(true);
            expect(
              z
                .object({ data: z.object({ summaryId: z.string() }) })
                .parse(detail.structuredContent).data.summaryId,
            ).toBe(row.summary.summaryId);
          }),
        );
      }),
    );

    const created = await client.callTool({ name: "create_workout", arguments: { workout } });
    expect(
      created.isError,
      "Garmin workout creation must succeed before proceeding; never retry an ambiguous write",
    ).not.toBe(true);
    const published = workoutResult.parse(created.structuredContent).data;
    workoutId = published.workoutId;
    await writeFile(
      `${sessionPath}.records.json`,
      JSON.stringify({ name, workoutId, date, cleanupComplete: false }),
      { mode: 0o600 },
    );
    expect(published.workoutName).toBe(name);
    const read = await client.callTool({ name: "get_workout", arguments: { workoutId } });
    expect(read.isError).not.toBe(true);
    const original = workoutResult.parse(read.structuredContent).data;
    expect(original.workoutName).toBe(name);
    const ownerId = required(original.ownerId, "Garmin workout ownerId");

    const updated = await client.callTool({
      name: "update_workout",
      arguments: { workoutId, ownerId, workout: { ...workout, workoutName: `${name} updated` } },
    });

    expect(updated.isError, JSON.stringify(updated.content)).not.toBe(true);
    const reread = await client.callTool({ name: "get_workout", arguments: { workoutId } });
    expect(workoutResult.parse(reread.structuredContent).data.workoutName).toBe(`${name} updated`);

    const scheduled = await client.callTool({
      name: "schedule_workout",
      arguments: { workoutId, date },
    });

    expect(scheduled.isError, JSON.stringify(scheduled.content)).not.toBe(true);

    const createdSchedule = z
      .object({ data: z.union([z.object({ scheduleId: trainingId }), mutationAccepted]) })
      .parse(scheduled.structuredContent);

    const returnedId = z.object({ scheduleId: trainingId }).safeParse(createdSchedule.data);

    if (returnedId.success) {
      scheduleId = returnedId.data.scheduleId;
    }

    await writeFile(
      `${sessionPath}.records.json`,
      JSON.stringify({ name, workoutId, scheduleId, date, cleanupComplete: false }),
      { mode: 0o600 },
    );

    // A successful empty response has no ID. Resolve it by reading the unique synthetic workout's date.
    const createdSchedules = await client.callTool({
      name: "list_workout_schedules",
      arguments: { startDate: date, endDate: date },
    });

    const matches = scheduleListResult
      .parse(createdSchedules.structuredContent)
      .data.filter((item) => item.workoutId === workoutId && item.date === date);

    expect(matches).toHaveLength(1);
    const entry = required(matches[0], "newly created workout schedule");
    scheduleId = entry.scheduleId;
    await writeFile(
      `${sessionPath}.records.json`,
      JSON.stringify({ name, workoutId, scheduleId, date, cleanupComplete: false }),
      { mode: 0o600 },
    );
    expect(entry).toMatchObject({ workoutId, date });

    const readSchedule = await client.callTool({
      name: "get_workout_schedule",
      arguments: { scheduleId },
    });

    expect(scheduleResult.parse(readSchedule.structuredContent).data).toMatchObject({
      workoutId,
      date,
    });

    const range = await client.callTool({
      name: "list_workout_schedules",
      arguments: { startDate: date, endDate: movedDate },
    });

    expect(
      scheduleListResult
        .parse(range.structuredContent)
        .data.some((item) => item.scheduleId === scheduleId),
    ).toBe(true);

    const moved = await client.callTool({
      name: "update_workout_schedule",
      arguments: { scheduleId, workoutId, date: movedDate },
    });

    expect(moved.isError, JSON.stringify(moved.content)).not.toBe(true);

    const rereadSchedule = await client.callTool({
      name: "get_workout_schedule",
      arguments: { scheduleId },
    });

    expect(scheduleResult.parse(rereadSchedule.structuredContent).data).toMatchObject({
      workoutId,
      date: movedDate,
    });
  } finally {
    await cleanup(client, workoutId, scheduleId, date, movedDate);
    await writeFile(
      `${sessionPath}.records.json`,
      JSON.stringify({ name, workoutId, scheduleId, date, cleanupComplete: true }),
      { mode: 0o600 },
    );
  }

  const discovery = await fetch(`${session.issuer}/.well-known/oauth-authorization-server`);
  const metadata = authorizationMetadata.parse(await discovery.json());

  const revoked = await fetch(metadata.revocation_endpoint, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: session.clientId,
      token: tokens.refresh_token,
      token_type_hint: "refresh_token",
    }),
  });

  expect(revoked.status).toBe(200);

  // Auth access JWTs remain valid until their short expiry; refresh revocation is immediate.
  const denied = await fetch(`${session.issuer}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: session.clientId,
      refresh_token: tokens.refresh_token,
      resource,
    }),
  });

  expect(denied.status).toBe(400);
});
