import type { E2EConfig } from "e2e";
import { mobile } from "@e2e-dev/mobile";

// Installed-app tests. The suite launches whatever build is already installed
// under this package id, so it exercises the release APK, not a dev server.
export default {
  targets: [
    {
      name: "android",
      engine: mobile({ platform: "android" }),
      app: { bundleId: "app.fivefold.lifts" },
    },
  ],
  workers: 1,
} satisfies E2EConfig;
