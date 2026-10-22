import type { E2EConfig } from "e2e";
import { mobile } from "@e2e-dev/mobile";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Installed-app tests. The suite launches whatever build is already installed
// under this package id, so it exercises the release APK, not a dev server.
//
// Agent steps are optional: the suite is deterministic locators and
// assertions. When a test does use `agent.act`, this endpoint serves the
// model. Set FREELLM_API_KEY in the shell that runs e2e. The endpoint's `auto`
// model routes to the best model in the account's active chain, so no model
// id has to be pinned here.
const freellm = createOpenAICompatible({
  name: "freellm",
  baseURL:
    process.env.FREELLM_BASE_URL ??
    "https://freellmapi-production-1175.up.railway.app/v1",
  apiKey: process.env.FREELLM_API_KEY,
});

export default {
  agents: {
    default: {
      model: freellm.chatModel("auto"),
    },
  },
  targets: [
    {
      name: "android",
      engine: mobile({ platform: "android" }),
      app: { bundleId: "app.fivefold.lifts" },
    },
  ],
  workers: 1,
} satisfies E2EConfig;
