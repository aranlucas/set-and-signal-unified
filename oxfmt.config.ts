import { format } from "@aranlucas/oxforge/format";
import web from "./web/oxfmt.config.ts";

export default format({
  sortTailwindcss: { stylesheet: "web/src/app/index.css" },
  ignorePatterns: [
    ...(web.ignorePatterns ?? []).map((pattern) => `web/${pattern}`),
    // Preserve the compact catalog embedded verbatim in the Go binary.
    "packages/exercises/catalog.json",
    // Imported applications own their formatting policy.
    "apps/**",
  ],
});
