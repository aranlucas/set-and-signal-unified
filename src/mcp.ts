import { McpServer } from "@modelcontextprotocol/server";
import type { ZodType } from "zod";
import { endpoints } from "./endpoints";
import { endpointPath, MAX_RANGE_DAYS, type ToolArguments } from "./tool-input";
import { GarminClient } from "./garmin";
import { GarminError } from "./garmin-error";

export function createServer(
  apiKey: string,
  scopes: readonly string[],
  fetcher: typeof fetch = fetch,
): McpServer {
  const server = new McpServer(
    { name: "garmin-personal", version: "1.0.0" },
    {
      instructions: `Read-only Garmin Connect Personal API. Data is supplied by Garmin Connect. Dates refer to Garmin calendar dates, not UTC timestamps. Daily range tools accept at most ${MAX_RANGE_DAYS} calendar days. list_activities uses start/limit pagination and allows wider date filters. Missing data is not zero. Do not infer medical diagnoses. Activity file downloads return base64, up to 2 MiB.`,
    },
  );

  const client = new GarminClient(apiKey, fetcher);

  for (const endpoint of endpoints) {
    if (!scopes.includes(endpoint.requiredScope)) {
      continue;
    }

    const inputSchema: ZodType<ToolArguments> = endpoint.inputSchema;
    const responseSchema: ZodType = endpoint.responseSchema;

    server.registerTool(
      endpoint.name,
      {
        description: `${endpoint.description} Source: Garmin Connect.`,
        inputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (args, ctx) => {
        try {
          const path = endpointPath(endpoint.path, endpoint.pathParameters, args);

          const data =
            endpoint.responseType === "file"
              ? await client.download(path, ctx.mcpReq.signal)
              : await client.get(responseSchema, path, ctx.mcpReq.signal);

          const result = { source: "Garmin Connect", data };

          return {
            structuredContent: result,
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        } catch (error) {
          const message =
            error instanceof GarminError
              ? error.message
              : "The Garmin request failed. Please try again.";

          return { isError: true, content: [{ type: "text", text: message }] };
        }
      },
    );
  }

  return server;
}
