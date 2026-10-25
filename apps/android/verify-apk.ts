// Native CLI/config rung: Expo/EAS builds the APK, while `apksigner`, `zipalign`, and `aapt2` expose separate facts; no repo config combines them to enforce this app's release signature, manifest, ABI, and clean-bundle gates.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { parseJson } from "./tests/support/parse-json";

// Fivefold release signing certificate, shared by all upgrade-compatible APKs.
export const RELEASE_CERT_SHA256 =
  "aa7ad6eee903940e6867adaf2a0b0f2be466042ac00ecde27343f466e2cf321f";

const ABIS = ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"];

type ExpectedRelease = { version: string; versionCode: number | undefined };

type ApkBadging = {
  package: string | undefined;
  versionCode: number | undefined;
  version: string | undefined;
  targetSdk: number;
  debuggable: boolean;
  abis: string[];
  activity: string | undefined;
};

type CommandResult = { status: number | null; stdout: string | Buffer; stderr?: string };

type GateInputs = {
  signer: CommandResult;
  alignment: CommandResult;
  badging: CommandResult;
  manifest: CommandResult;
  bundle: CommandResult;
  sha256: string;
  checksum: string | undefined;
};

type ApkGate = { name: string; passed: boolean };

type ApkGateEntry = [name: string, passed: boolean];

const PackageManifestSchema = z.object({ version: z.string() });

const AppManifestSchema = z.object({
  expo: z.object({ android: z.object({ versionCode: z.number() }) }),
});

function runCommand(
  tool: string,
  argv: string[],
  encoding: BufferEncoding | null = "utf8",
): CommandResult {
  const result = spawnSync(tool, argv, { encoding, maxBuffer: 80_000_000 });

  return {
    status: result.status,
    stdout: result.stdout ?? (encoding ? "" : Buffer.alloc(0)),
    stderr:
      result.error?.message ??
      (Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8") : (result.stderr ?? "")),
  };
}

export function expectedRelease(
  apk: string,
  version: string,
  versionCode: number,
  explicit = false,
): ExpectedRelease {
  const expectedVersion = explicit
    ? (basename(apk).match(/^Fivefold-(\d+\.\d+\.\d+)\.apk$/)?.[1] ?? version)
    : version;

  return {
    version: expectedVersion,
    versionCode: expectedVersion === version ? versionCode : undefined,
  };
}

export function parseBadging(output: string): ApkBadging {
  const pkg = output.match(/^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m);

  return {
    package: pkg?.[1],
    versionCode: pkg ? Number(pkg[2]) : undefined,
    version: pkg?.[3],
    targetSdk: Number(output.match(/^targetSdkVersion:'(\d+)'/m)?.[1]),
    debuggable: /^application-debuggable\b/m.test(output),
    abis: [...(output.match(/^native-code:(.*)$/m)?.[1] ?? "").matchAll(/'([^']+)'/g)].map(
      (match) => match[1] ?? "",
    ),
    activity: output.match(/^launchable-activity: name='([^']+)'/m)?.[1],
  };
}

export function isPortrait(manifest: string, activity: string | undefined): boolean {
  if (!activity) {
    return false;
  }

  const blocks = manifest.split(/(?=^\s*E: activity\s)/m);

  return blocks.some((block: string) => {
    // Limit to the activity's own attributes, never a later receiver/activity.
    const attributes = block.split(/^\s*E:/m).slice(1)[0] ?? "";
    const name = attributes.match(/android:name\([^)]*\)="([^"]+)"/)?.[1];
    const orientation = attributes.match(/android:screenOrientation\([^)]*\)=(\S+)/)?.[1];

    return name === activity && /^(?:1|0x0*1|"portrait")$/.test(orientation ?? "");
  });
}

/** Pure gates: SDK process outputs enter here; Vitest needs no SDK or APK. */
export function apkGates(
  { signer, alignment, badging, manifest, bundle, sha256, checksum }: GateInputs,
  expected: ExpectedRelease,
): ApkGate[] {
  const info = parseBadging(String(badging.stdout));

  const certs = [
    ...String(signer.stdout).matchAll(/certificate SHA-256 digest:\s*([\da-f:]+)/gi),
  ].map((m) => m[1].replaceAll(":", "").toLowerCase());

  const gates: ApkGateEntry[] = [
    makeGate(
      "release signature",
      signer.status === 0 &&
        certs.length > 0 &&
        certs.every((cert) => cert === RELEASE_CERT_SHA256),
    ),
    makeGate("16 KB ZIP alignment", alignment.status === 0),
    makeGate(
      "package app.fivefold.lifts",
      badging.status === 0 && info.package === "app.fivefold.lifts",
    ),
    makeGate(`versionName ${expected.version}`, info.version === expected.version),
    ...(expected.versionCode === undefined
      ? []
      : [
          makeGate(
            `versionCode ${expected.versionCode}`,
            info.versionCode === expected.versionCode,
          ),
        ]),
    makeGate("target SDK >= 36", info.targetSdk >= 36),
    makeGate("not debuggable", badging.status === 0 && !info.debuggable),
    makeGate(
      "four release ABIs",
      ABIS.every((abi) => info.abis.includes(abi)),
    ),
    makeGate(
      "main activity portrait",
      manifest.status === 0 && isPortrait(String(manifest.stdout), info.activity),
    ),
    makeGate(
      "Hermes bundle without measurement instrumentation",
      bundle.status === 0 &&
        bundle.stdout.length > 0 &&
        !bundle.stdout.includes("FIVEFOLD_PERF") &&
        !bundle.stdout.includes("seed-"),
    ),
    ...(checksum === undefined
      ? []
      : [
          makeGate(
            "SHA-256 sidecar",
            /^[a-f\d]{64}$/i.test(checksum) && sha256 === checksum.toLowerCase(),
          ),
        ]),
  ];

  return gates.map(([name, passed]) => ({ name, passed }));
}

function makeGate(name: string, passed: boolean): ApkGateEntry {
  return [name, passed];
}

export function sdkRoot(): string {
  const androidHome = z.string().optional().parse(process.env.ANDROID_HOME);

  return androidHome ?? join(homedir(), "Library/Android/sdk");
}

export function latestBuildTools(root = sdkRoot()): string {
  const dir = join(root, "build-tools");

  if (!existsSync(dir)) {
    throw new Error(`Android SDK build-tools missing: ${dir}`);
  }

  const versions = readdirSync(dir)
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (!versions.length) {
    throw new Error(`No stable Android build-tools installed under ${dir}`);
  }

  const latest = versions.at(-1);

  if (!latest) {
    throw new Error(`No stable Android build-tools installed under ${dir}`);
  }

  return join(dir, latest);
}

export function main(args: string[] = process.argv.slice(2)): number {
  if (args.length > 1) {
    throw new Error("Usage: pnpm exec tsx verify-apk.ts [artifacts/Fivefold-<version>.apk]");
  }

  const pkg = parseJson(readFileSync("package.json", "utf8"), PackageManifestSchema);
  const app = parseJson(readFileSync("app.json", "utf8"), AppManifestSchema);
  const apk = resolve(args[0] ?? `artifacts/Fivefold-${pkg.version}.apk`);

  if (!existsSync(apk)) {
    throw new Error(`APK missing. Put the signed release at ${apk}`);
  }

  const buildTools = latestBuildTools();

  const signer = runCommand(join(buildTools, "apksigner"), ["verify", "--print-certs", apk]);
  const alignment = runCommand(join(buildTools, "zipalign"), ["-c", "-P", "16", "-v", "4", apk]);
  const badging = runCommand(join(buildTools, "aapt2"), ["dump", "badging", apk]);

  const manifest = runCommand(join(buildTools, "aapt2"), [
    "dump",
    "xmltree",
    apk,
    "--file",
    "AndroidManifest.xml",
  ]);

  const bundle = runCommand("unzip", ["-p", apk, "assets/index.android.bundle"], null);
  const expected = expectedRelease(apk, pkg.version, app.expo.android.versionCode, args.length > 0);
  const sidecar = resolve(`artifacts/Fivefold-${expected.version}.apk.sha256`);

  const apkBytes = readFileSync(apk);

  const gates = apkGates(
    {
      signer,
      alignment,
      badging,
      manifest,
      bundle,
      sha256: createHash("sha256").update(apkBytes).digest("hex"),
      checksum: existsSync(sidecar)
        ? readFileSync(sidecar, "utf8").trim().split(/\s+/)[0]
        : undefined,
    },
    expected,
  );

  for (const gate of gates) {
    process.stdout.write(`${gate.passed ? "PASS" : "FAIL"} ${gate.name}\n`);
  }

  for (const [name, result] of Object.entries({
    signer,
    alignment,
    badging,
    manifest,
    bundle,
  })) {
    if (result.status !== 0) {
      const detail = Buffer.isBuffer(result.stderr)
        ? result.stderr.toString("utf8")
        : (result.stderr ?? "command failed");

      process.stderr.write(`FAIL ${name} command: ${detail.trim()}\n`);
    }
  }

  return gates.every((gate) => gate.passed) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`FAIL ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
