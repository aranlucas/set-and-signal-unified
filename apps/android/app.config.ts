import type { ConfigContext, ExpoConfig } from "expo/config";

// Expo's config supports a separate local QA install without touching an
// existing Fivefold installation or changing its upgrade identity.
export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const base = {
    ...config,
    name: config.name ?? "Set & Signal",
    slug: config.slug ?? "fivefold-5x5",
  };

  if (process.env.FITNESS_QA !== "1") {
    return base;
  }

  return {
    ...base,
    name: "Set & Signal QA",
    scheme: "setandsignalqa",
    android: { ...base.android, package: "app.fivefold.lifts.qa" },
  };
}
