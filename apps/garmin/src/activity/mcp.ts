import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { GarminUserData } from "../push/store";
import { fetchActivityFile, garminActivityId, type FitDetails } from "./files";

type ActivityAccess = {
  store: DurableObjectStub<GarminUserData>;
  accessToken: string;
  fetcher: typeof fetch;
  permitted: (signal: AbortSignal) => Promise<void>;
};

export async function activityFit(access: ActivityAccess, activityId: string, signal: AbortSignal) {
  const { store, accessToken, fetcher, permitted } = access;
  const file = await store.claimActivityFile(activityId);

  if (file.data) {
    return z.record(z.string(), z.json()).parse(JSON.parse(file.data));
  }

  if (!file.callback || !file.version || !file.summaryId) {
    return { availability: file.state, sets: [] };
  }

  let decoded: FitDetails | null = null;

  try {
    decoded = {
      ...(await fetchActivityFile(file.callback, accessToken, signal, fetcher)),
      activityId,
      fileSummaryId: file.summaryId,
    };
  } catch {
    // Never expose callback credentials, parser diagnostics, or partial FIT messages. A one-use
    // download may have been consumed, so an ambiguous failure is not retried.
  }

  await permitted(signal);
  const saved = await store.finishActivityFile(activityId, file.version, decoded);

  return saved
    ? z.record(z.string(), z.json()).parse(JSON.parse(saved))
    : { availability: "unavailable", sets: [] };
}

export function registerActivityTools(server: McpServer, access: ActivityAccess) {
  server.registerTool(
    "get_garmin_activity",
    {
      description:
        "Get a stored Garmin activity by activityId from list_garmin_summaries, including its summary, JSON details, and all SDK-decoded FIT message types and fields. Includes samples, GPS, sessions, laps, events, device metadata, developer fields, and strength sets when recorded. Uses cached FIT data or downloads a pending received file. Garmin file links expire after 24 hours. Missing data means unavailable, not no activity. Does not fetch historical activities. Source: Garmin Connect.",
      inputSchema: z.strictObject({ activityId: garminActivityId }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ activityId }, ctx) => {
      try {
        const signal = ctx.mcpReq.signal;
        await access.permitted(signal);
        const activity = await access.store.getActivity(activityId);
        const fit = activity ? await activityFit(access, activityId, signal) : null;
        // Re-read after download: deletion or withdrawal during I/O must not return old summaries.
        const current = activity ? await access.store.getActivity(activityId) : null;

        const output = {
          source: "Garmin Connect",
          data: current
            ? {
                activityId,
                summary: current.summary
                  ? z.record(z.string(), z.json()).parse(JSON.parse(current.summary))
                  : null,
                details: current.details
                  ? z.record(z.string(), z.json()).parse(JSON.parse(current.details))
                  : null,
                fit,
              }
            : null,
        };

        return {
          structuredContent: output,
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Garmin activity is unavailable or permission was withdrawn. Reconnect Garmin in Auth and try again.",
            },
          ],
        };
      }
    },
  );
}
