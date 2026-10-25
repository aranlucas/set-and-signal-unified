import { describe, test } from "@e2e-dev/mobile";
import { expect } from "e2e";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { parseJson } from "../support/parse-json";
import { finishWorkout, startWorkout, tap } from "./support";

const packageManifest = parseJson(
  readFileSync("package.json", "utf8"),
  z.object({ version: z.string() }),
);

const UpgradeEnvironmentSchema = z.object({
  FIVEFOLD_APK: z.string().optional(),
  FIVEFOLD_PREVIOUS_APK: z.string().optional(),
});

const upgradeEnvironment = UpgradeEnvironmentSchema.parse(process.env);

const compare = (a: string, b: string) => {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) {
      return left[i] - right[i];
    }
  }

  return 0;
};

function releaseApks() {
  const versions = readdirSync("artifacts")
    .flatMap((file) => /^Fivefold-(\d+\.\d+\.\d+)\.apk$/.exec(file)?.[1] ?? [])
    .filter((version) => compare(version, packageManifest.version) < 0)
    .toSorted(compare);

  const previous = resolve(
    upgradeEnvironment.FIVEFOLD_PREVIOUS_APK ??
      `artifacts/Fivefold-${versions.at(-1) ?? "<previous-version>"}.apk`,
  );

  const current = resolve(
    upgradeEnvironment.FIVEFOLD_APK ?? `artifacts/Fivefold-${packageManifest.version}.apk`,
  );

  for (const [kind, apk] of [
    ["previous", previous],
    ["current", current],
  ]) {
    if (!existsSync(apk)) {
      throw new Error(
        `Missing ${kind} signed APK. Put it at ${apk} or set ${kind === "previous" ? "FIVEFOLD_PREVIOUS_APK" : "FIVEFOLD_APK"}.`,
      );
    }
  }

  const sidecar = `${previous}.sha256`;

  if (!existsSync(sidecar)) {
    throw new Error(`Put the matching previous-release checksum at ${sidecar}.`);
  }

  const expected = readFileSync(sidecar, "utf8").trim().split(/\s+/)[0];
  expect(
    createHash("sha256").update(readFileSync(previous)).digest("hex"),
    `Previous APK checksum: ${sidecar}`,
  ).toBe(expected);

  return { previous, current };
}

describe("signed upgrade in place", { serial: true }, () => {
  test(
    "preserves workout, next workout, kg and standard plates",
    { timeout: 180_000 },
    async ({ app, device, screen }) => {
      const { previous, current } = releaseApks();
      await app.clearState();

      try {
        await device.installApp(previous, { reinstall: true });
        await app.open();
        await expect(screen.getByText("Train")).toBeVisible();

        // 1.2.1 starts in kg without a choice; 1.3.0 offers lb/kg on first run.
        if (await screen.getByText("Kilograms").isVisible()) {
          await tap(screen, screen.getByText("Kilograms"));
        }

        await expect(screen.getByText("20 kg").first()).toBeVisible();
        await startWorkout(screen, "A", 15);
        await tap(screen, screen.getByLabel(/^Squat, set 1 of 5, not logged/));
        await expect(screen.getByText("1 / 15 sets")).toBeVisible();
        await finishWorkout(screen);
        await device.closeApp();
        await device.installApp(current);
        await app.open();
        await expect(screen.getByText("Start workout B")).toBeVisible();
        await tap(screen, screen.getByText("History"));
        await expect(screen.getByText("1 saved workout")).toBeVisible();
        await expect(screen.getByText("Workout A")).toBeVisible();
        await tap(screen, screen.getByText("Settings"));
        await expect(screen.getByText("kg", { exact: true })).toBeVisible();
        await tap(screen, screen.getByText("Weights & equipment"));
        await screen.scrollUntilVisible(screen.getByText("Plates"));
        await expect(screen.getByText("Standard gym")).toBeVisible();
      } finally {
        await device.installApp(current, { reinstall: true });
      }
    },
  );
});
