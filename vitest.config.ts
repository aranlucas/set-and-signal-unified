import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            experimental: { newConfig: true },
            miniflare: {
              bindings: {
                GARMIN_PUSH_TOKEN: "test-only-delivery-credential-with-at-least-32-characters",
              },
              durableObjects: { USER_DATA: { className: "GarminUserData", useSQLite: true } },
              serviceBindings: {
                AUTH: { name: "auth-events-fixture", entrypoint: "GarminTokens" },
              },
              workers: [
                {
                  name: "auth-events-fixture",
                  modules: true,
                  compatibilityDate: "2026-10-21",
                  script: `
                  import { WorkerEntrypoint } from "cloudflare:workers";
                  export class GarminTokens extends WorkerEntrypoint {
                    accessToken(subject) {
                      return subject.startsWith("unlinked-") ? null : {
                        accessToken: "fixture-" + subject,
                        expiresAt: Date.now() + 60000,
                        garminUserId: subject,
                      };
                    }
                  }
                  export default { fetch() { return new Response(null, { status: 404 }); } };
                `,
                },
              ],
            },
          }),
        ],
        test: {
          name: "worker",
          include: ["test/**/*.test.ts"],
          exclude: [
            "test/smoke.test.ts",
            "test/push-live.test.ts",
            "test/exchange-live.test.ts",
            "test/personal-backfill-live.test.ts",
          ],
        },
      },
      {
        test: {
          name: "push-live",
          include: ["test/push-live.test.ts"],
          environment: "node",
          testTimeout: 30000,
        },
      },
      {
        test: {
          name: "exchange-live",
          include: ["test/exchange-live.test.ts"],
          environment: "node",
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: "personal-backfill-live",
          include: ["test/personal-backfill-live.test.ts"],
          environment: "node",
          testTimeout: 600_000,
        },
      },
      // Live deployment checks; run explicitly with `pnpm run smoke`.
      {
        test: {
          name: "smoke",
          include: ["test/smoke.test.ts"],
          environment: "node",
          testTimeout: 30_000,
        },
      },
    ],
  },
});
