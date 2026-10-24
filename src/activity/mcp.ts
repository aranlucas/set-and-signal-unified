import type { McpServer } from "@modelcontextprotocol/server";
import { decodeStrengthActivityFile, strengthFileInput } from "./strength";

export function registerActivityFileTools(server: McpServer) {
  server.registerTool(
    "decode_strength_activity_file",
    {
      description:
        "Decode recorded strength exercises, sets, repetitions, weights in kg, and explicit rest sets from a user-provided original FIT activity file. Supply canonical base64 of the uncompressed file, up to 1 MiB. Does not download from Garmin, accept URLs, store files, infer missing values, or prove a match to a stored activity. No recorded sets means unavailable, not no strength training.",
      inputSchema: strengthFileInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) => {
      try {
        const output = decodeStrengthActivityFile(input.fitBase64);

        return {
          structuredContent: output,
          content: [{ type: "text" as const, text: JSON.stringify(output) }],
        };
      } catch {
        // Never return parser errors: malformed files may carry private or attacker-controlled data.
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Unable to decode the activity file. Supply canonical base64 of one valid FIT activity file up to 1 MiB, with at most 25,000 messages including definitions, 2,000 sets, and 4,000 exercise entries. ZIP files, planned workouts, and FIT compressed-timestamp records are not supported. No partial results were returned.",
            },
          ],
        };
      }
    },
  );
}
