import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { endpoints } from "./endpoints";
import { WOMENS_SCOPE } from "./scopes";
import {
  endpointPath,
  MAX_RANGE_DAYS,
  parameterSchema,
  validateDateRange,
  type ToolArgumentSchema,
} from "./tool-input";
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
      instructions: `Read-only Garmin Connect Personal API. Data is supplied by Garmin Connect. Dates refer to Garmin calendar dates, not UTC timestamps. Use ranges of at most ${MAX_RANGE_DAYS} days. Missing data is not zero. Do not infer medical diagnoses. Activity file downloads return base64, up to 2 MiB.`,
    },
  );

  const client = new GarminClient(apiKey, fetcher);

  for (const endpoint of endpoints) {
    if (endpoint.sensitive && !scopes.includes(WOMENS_SCOPE)) {
      continue;
    }

    const inputFields: Record<string, ToolArgumentSchema> = {};

    for (const parameter of endpoint.parameters) {
      inputFields[parameter.name] = parameterSchema(parameter);
    }

    // Paged results are bounded by `limit`; their date filters need no range cap.

    const paged = "limit" in inputFields;
    const ranged = !paged && ["endDate", "toDate", "untilDate"].some((name) => name in inputFields);
    server.registerTool(
      endpoint.name,
      {
        description: `${endpoint.description} Source: Garmin Connect.${ranged ? ` Date ranges are limited to ${MAX_RANGE_DAYS} days.` : ""}`,
        inputSchema: z.object(inputFields).strict(),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (args) => {
        try {
          if (ranged) {
            validateDateRange(args);
          }

          const data = await client.get(
            endpointPath(endpoint.path, endpoint.parameters, args),
            endpoint.binary,
          );

          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ source: "Garmin Connect", data }) },
            ],
          };
        } catch (error) {
          const message =
            error instanceof GarminError
              ? error.message
              : "The Garmin request failed. Please try again.";

          return { isError: true, content: [{ type: "text" as const, text: message }] };
        }
      },
    );
  }

  return server;
}
