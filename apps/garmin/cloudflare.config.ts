import { bindings, defineConfig, exports } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig(({ mode }) => ({
  accountId: "d93c650f72e597f96785abba389b0ce4",
  worker: {
    name: "garmin-mcp",
    entrypoint,
    exports: { GarminUserData: exports.durableObject({ storage: "sqlite" }) },
    compatibilityDate: "2026-10-21",
    // Outgoing event callbacks rely on native public Internet routing, never private origins.
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    workersDev: true,
    previewUrls: false,
    // Webhook credentials are in the configured delivery URL. Never retain request URLs in logs/traces.
    observability: {
      enabled: true,
      logs: { enabled: true, invocationLogs: false },
      traces: { enabled: false },
    },
    env: {
      PUBLIC_URL: bindings.text(
        mode === "development"
          ? "http://localhost:5173"
          : "https://garmin-mcp.aranlucas.workers.dev",
      ),
      AUTH_ISSUER: bindings.text("https://auth.aranlucas.workers.dev/api/auth"),
      AUTH: bindings.worker({ worker: "auth", exportName: "GarminTokens" }),
      GARMIN_PUSH_TOKEN: bindings.secret(),
      USER_DATA: bindings.durableObject({ worker: "garmin-mcp", exportName: "GarminUserData" }),
    },
  },
}));
