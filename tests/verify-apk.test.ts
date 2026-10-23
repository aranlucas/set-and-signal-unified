import { describe, expect, test } from "vitest";
import {
  apkGates,
  expectedRelease,
  isPortrait,
  parseBadging,
  RELEASE_CERT_SHA256,
} from "../verify-apk.mjs";
import { deviceSerials, matrixAvds } from "../e2e-matrix.mjs";

// Captured aapt2/apksigner lines from the signed 1.3.0 artifact, no SDK needed.
const badging = `package: name='app.fivefold.lifts' versionCode='5' versionName='1.3.0' platformBuildVersionName='17'
targetSdkVersion:'36'
launchable-activity: name='app.fivefold.lifts.MainActivity' label='Fivefold' icon=''
native-code: 'arm64-v8a' 'armeabi-v7a' 'x86' 'x86_64'`;
const manifest = `E: manifest
    E: application
        E: activity (line=123)
          A: http://schemas.android.com/apk/res/android:name(0x01010003)="app.fivefold.lifts.MainActivity" (Raw: "app.fivefold.lifts.MainActivity")
          A: http://schemas.android.com/apk/res/android:screenOrientation(0x0101001e)=1
            E: intent-filter
        E: activity
          A: http://schemas.android.com/apk/res/android:name(0x01010003)="OtherActivity"
          A: http://schemas.android.com/apk/res/android:screenOrientation(0x0101001e)=0`;
const ok = (stdout: string | Buffer) => ({ status: 0, stdout });
const input = () => ({
  signer: ok(`V2 Signer: certificate SHA-256 digest: ${RELEASE_CERT_SHA256}`),
  alignment: ok("Verification successful"),
  badging: ok(badging),
  manifest: ok(manifest),
  bundle: ok(Buffer.from("Hermes release bytecode")),
  sha256: "a".repeat(64),
  checksum: "a".repeat(64),
});
const expected = { version: "1.3.0", versionCode: 5 };
const failures = (data: ReturnType<typeof input>) =>
  apkGates(data, expected)
    .filter((g: { passed: boolean }) => !g.passed)
    .map((g: { name: string }) => g.name);

describe("signed APK release gates", () => {
  test("accepts captured release metadata and a binary bundle", () => {
    expect(failures(input())).toEqual([]);
    expect(parseBadging(badging)).toMatchObject({
      version: "1.3.0",
      versionCode: 5,
      targetSdk: 36,
    });
  });
  test.each([
    [
      "signature failure",
      (d: ReturnType<typeof input>) => {
        d.signer.status = 1;
      },
      "release signature",
    ],
    [
      "wrong key",
      (d: ReturnType<typeof input>) => {
        d.signer.stdout = "certificate SHA-256 digest: " + "b".repeat(64);
      },
      "release signature",
    ],
    [
      "alignment",
      (d: ReturnType<typeof input>) => {
        d.alignment.status = 1;
      },
      "16 KB ZIP alignment",
    ],
    [
      "SDK",
      (d: ReturnType<typeof input>) => {
        d.badging.stdout = badging.replace("'36'", "'35'");
      },
      "target SDK >= 36",
    ],
    [
      "debug",
      (d: ReturnType<typeof input>) => {
        d.badging.stdout += "\napplication-debuggable";
      },
      "not debuggable",
    ],
    [
      "ABI",
      (d: ReturnType<typeof input>) => {
        d.badging.stdout = badging.replace("'x86'", "");
      },
      "four release ABIs",
    ],
    [
      "portrait",
      (d: ReturnType<typeof input>) => {
        d.manifest.stdout = manifest.replace(
          "screenOrientation(0x0101001e)=1",
          "screenOrientation(0x0101001e)=0",
        );
      },
      "main activity portrait",
    ],
    [
      "perf",
      (d: ReturnType<typeof input>) => {
        d.bundle.stdout = Buffer.from("FIVEFOLD_PERF");
      },
      "Hermes bundle without measurement instrumentation",
    ],
    [
      "seed",
      (d: ReturnType<typeof input>) => {
        d.bundle.stdout = Buffer.from("\0seed-10000");
      },
      "Hermes bundle without measurement instrumentation",
    ],
    [
      "checksum",
      (d: ReturnType<typeof input>) => {
        d.checksum = "b".repeat(64);
      },
      "SHA-256 sidecar",
    ],
    [
      "missing badging",
      (d: ReturnType<typeof input>) => {
        d.badging.stdout = "";
        d.badging.status = 1;
      },
      "package app.fivefold.lifts",
    ],
    [
      "version",
      (d: ReturnType<typeof input>) => {
        d.badging.stdout = badging.replace("'1.3.0'", "'1.2.1'");
      },
      "versionName 1.3.0",
    ],
    [
      "code",
      (d: ReturnType<typeof input>) => {
        d.badging.stdout = badging.replace(
          "versionCode='5'",
          "versionCode='4'",
        );
      },
      "versionCode 5",
    ],
  ])("rejects %s", (_name, mutate, gate) => {
    const data = input();
    mutate(data);
    expect(failures(data)).toContain(gate);
  });
  test("does not borrow portrait from another activity", () => {
    expect(isPortrait(manifest, "MissingActivity")).toBe(false);
    expect(isPortrait(manifest, "OtherActivity")).toBe(false);
    expect(
      isPortrait(
        "E: application\n A: android:screenOrientation(1)=1",
        "MainActivity",
      ),
    ).toBe(false);
  });
  test("explicit historical filename selects version but current build still checks code", () => {
    expect(
      expectedRelease("artifacts/Fivefold-1.3.0.apk", "1.3.1", 6, true),
    ).toEqual({ version: "1.3.0", versionCode: undefined });
    expect(
      expectedRelease("artifacts/Fivefold-1.3.1.apk", "1.3.1", 6, true),
    ).toEqual({ version: "1.3.1", versionCode: 6 });
    expect(expectedRelease("custom.apk", "1.3.1", 6, true)).toEqual({
      version: "1.3.1",
      versionCode: 6,
    });
  });
});
test("matrix validates AVDs and sees occupied offline devices", () => {
  expect(matrixAvds(undefined)).toEqual([
    "Pixel_API_35",
    "Agents_Android_17_API_37_2",
  ]);
  expect(() => matrixAvds("one,one")).toThrow(/distinct/);
  expect(() => matrixAvds("one,")).toThrow(/nonempty/);
  expect(
    deviceSerials(
      "List of devices attached\nemulator-5556\tdevice\nemulator-5560\toffline\n",
    ),
  ).toEqual(["emulator-5556", "emulator-5560"]);
});
