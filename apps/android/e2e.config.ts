import type { E2EConfig } from "e2e";
import { mobile, type MobileOptions } from "@e2e-dev/mobile";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";

// Installed-app tests. The suite launches whatever build is already installed
// under this package id, so it exercises the release APK, not a dev server.
//
// Agent steps are optional: the suite is deterministic locators and
// assertions. When a test does use `agent.act`, this endpoint serves the
// model. Set FREELLM_API_KEY in the shell that runs e2e. The endpoint's `auto`
// model routes to the best model in the account's active chain, so no model
// id has to be pinned here.
const environment = z
  .object({
    FREELLM_BASE_URL: z
      .string()
      .url()
      .default("https://freellmapi-production-1175.up.railway.app/v1"),
    FREELLM_API_KEY: z.string().optional(),
    E2E_DEVICE: z.string().optional(),
  })
  .parse(process.env);

const freellm = createOpenAICompatible({
  name: "freellm",
  baseURL: environment.FREELLM_BASE_URL,
  apiKey: environment.FREELLM_API_KEY,
});

const deviceId = environment.E2E_DEVICE;

const mobileOptions: MobileOptions = deviceId
  ? { platform: "android", session: ["fivefold", deviceId].join("-"), device: deviceId }
  : { platform: "android", session: "fivefold-android" };

export default {
  agents: {
    default: {
      model: freellm.chatModel("auto"),
    },
  },
  targets: [
    {
      name: "android",
      // Separate pinned devices must not share agent-device's default session.
      engine: mobile(mobileOptions),
      app: { bundleId: "app.fivefold.lifts" },
    },
  ],
  workers: 1,
} satisfies E2EConfig;
