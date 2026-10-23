import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { registerTrainingTools, TRAINING_INSTRUCTIONS } from "./training/mcp";
import { TrainingClient } from "./training/client";
import { listSummariesInput, summaryType, isActivityType } from "./push/schemas";
import type { GarminUserData } from "./push/store";

const result = (data: z.infer<ReturnType<typeof z.json>>) => {
  const output = {
    source: "Garmin Connect",
    availability:
      "Only push data received since linking; 90-day retention; no Starter historical backfill.",
    data,
  };

  return {
    structuredContent: output,
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
  };
};

export function createServer(
  accessToken: string,
  store: DurableObjectStub<GarminUserData>,
  fetcher: typeof fetch = fetch,
) {
  const server = new McpServer(
    { name: "garmin", version: "2.0.0" },
    {
      instructions:
        "Garmin Connect via Auth. Health and activity tools read push data received since linking, retained for 90 days. Starter has no historical backfill. Empty results do not mean no activity occurred. Workout tools change Garmin Connect: confirm details and dates first, never automatically retry ambiguous writes. Successful scheduling does not confirm watch delivery. Garmin credentials must never appear in results." +
        TRAINING_INSTRUCTIONS,
    },
  );

  registerTrainingTools(server, accessToken, fetcher);
  const client = new TrainingClient(accessToken, fetcher);

  async function permitted(type: string, signal: AbortSignal) {
    const permissions = await client.getPermissions(signal);

    const needed = isActivityType(type) ? "ACTIVITY_EXPORT" : "HEALTH_EXPORT";

    if (!permissions.includes(needed)) {
      throw new Error(`Garmin ${needed} permission is missing. Reconnect Garmin in Auth.`);
    }
  }

  server.registerTool(
    "list_garmin_summaries",
    {
      description:
        "Read stored Garmin Health/Activity push summaries for a date range of at most 31 days, with pagination. dailies includes steps/heart rate; epochs includes heart rate samples; sleeps, hrv, bodyComps, stressDetails and other summary types use Garmin's official push model. Empty results mean no received records, not zero activity. Source: Garmin Connect.",
      inputSchema: listSummariesInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input, ctx) => {
      try {
        await permitted(input.type, ctx.mcpReq.signal);

        const rows = await store.list(
          input.type,
          input.startDate,
          input.endDate,
          input.limit,
          input.offset,
        );

        return result({
          ...rows,
          records: rows.records.map(({ receivedAt, summaryJSON }) => ({
            receivedAt,
            summary: z.record(z.string(), z.json()).parse(JSON.parse(summaryJSON)),
          })),
        });
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Garmin data is unavailable or permission was withdrawn. Reconnect Garmin in Auth and try again.",
            },
          ],
        };
      }
    },
  );
  server.registerTool(
    "get_garmin_summary",
    {
      description:
        "Read a received Garmin summary by its type and summaryId from list_garmin_summaries. Does not fetch historical data from Garmin. Source: Garmin Connect.",
      inputSchema: z.strictObject({ type: summaryType, summaryId: z.string().min(1).max(255) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input, ctx) => {
      try {
        await permitted(input.type, ctx.mcpReq.signal);
        const row = await store.get(input.type, input.summaryId);

        return result(row ? z.record(z.string(), z.json()).parse(JSON.parse(row)) : null);
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Garmin data is unavailable or permission was withdrawn. Reconnect Garmin in Auth and try again.",
            },
          ],
        };
      }
    },
  );
  server.registerTool(
    "delete_stored_garmin_data",
    {
      description:
        "Delete all Health/Activity summaries stored by this connector. Confirm deletion first. Does not delete Garmin Connect records. Future syncs can deliver new data; disconnect Garmin in Auth to stop collection.",
      inputSchema: z.strictObject({ confirm: z.literal(true) }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      await store.clear();

      return result({ deleted: true });
    },
  );

  return server;
}
