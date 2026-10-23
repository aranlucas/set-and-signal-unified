import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Fivefold release signing certificate, shared by all upgrade-compatible APKs.
export const RELEASE_CERT_SHA256 =
  "aa7ad6eee903940e6867adaf2a0b0f2be466042ac00ecde27343f466e2cf321f";
const ABIS = ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"];

export function expectedRelease(apk, version, versionCode, explicit = false) {
  const expectedVersion = explicit
    ? (basename(apk).match(/^Fivefold-(\d+\.\d+\.\d+)\.apk$/)?.[1] ?? version)
    : version;
  return {
    version: expectedVersion,
    versionCode: expectedVersion === version ? versionCode : undefined,
  };
}

export function parseBadging(output) {
  const pkg = output.match(
    /^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'/m,
  );
  return {
    package: pkg?.[1],
    versionCode: pkg ? Number(pkg[2]) : undefined,
    version: pkg?.[3],
    targetSdk: Number(output.match(/^targetSdkVersion:'(\d+)'/m)?.[1]),
    debuggable: /^application-debuggable\b/m.test(output),
    abis: [
      ...(output.match(/^native-code:(.*)$/m)?.[1] ?? "").matchAll(
        /'([^']+)'/g,
      ),
    ].map((m) => m[1]),
    activity: output.match(/^launchable-activity: name='([^']+)'/m)?.[1],
  };
}

export function isPortrait(manifest, activity) {
  if (!activity) return false;
  const blocks = manifest.split(/(?=^\s*E: activity\s)/m);
  return blocks.some((block) => {
    // Limit to the activity's own attributes, never a later receiver/activity.
    const attributes = block.split(/^\s*E:/m).slice(1)[0] ?? "";
    const name = attributes.match(/android:name\([^)]*\)="([^"]+)"/)?.[1];
    const orientation = attributes.match(
      /android:screenOrientation\([^)]*\)=(\S+)/,
    )?.[1];
    return (
      name === activity && /^(?:1|0x0*1|"portrait")$/.test(orientation ?? "")
    );
  });
}

/** Pure gates: SDK process outputs enter here; Vitest needs no SDK or APK. */
export function apkGates(
  { signer, alignment, badging, manifest, bundle, sha256, checksum },
  expected,
) {
  const info = parseBadging(badging.stdout);
  const certs = [
    ...signer.stdout.matchAll(/certificate SHA-256 digest:\s*([\da-f:]+)/gi),
  ].map((m) => m[1].replaceAll(":", "").toLowerCase());
  return [
    [
      "release signature",
      signer.status === 0 &&
        certs.length > 0 &&
        certs.every((cert) => cert === RELEASE_CERT_SHA256),
    ],
    ["16 KB ZIP alignment", alignment.status === 0],
    [
      "package app.fivefold.lifts",
      badging.status === 0 && info.package === "app.fivefold.lifts",
    ],
    [`versionName ${expected.version}`, info.version === expected.version],
    ...(expected.versionCode === undefined
      ? []
      : [
          [
            `versionCode ${expected.versionCode}`,
            info.versionCode === expected.versionCode,
          ],
        ]),
    ["target SDK >= 36", info.targetSdk >= 36],
    ["not debuggable", badging.status === 0 && !info.debuggable],
    ["four release ABIs", ABIS.every((abi) => info.abis.includes(abi))],
    [
      "main activity portrait",
      manifest.status === 0 && isPortrait(manifest.stdout, info.activity),
    ],
    [
      "Hermes bundle without measurement instrumentation",
      bundle.status === 0 &&
        bundle.stdout.length > 0 &&
        !bundle.stdout.includes("FIVEFOLD_PERF") &&
        !bundle.stdout.includes("seed-"),
    ],
    ...(checksum === undefined
      ? []
      : [
          [
            "SHA-256 sidecar",
            /^[a-f\d]{64}$/i.test(checksum) &&
              sha256 === checksum.toLowerCase(),
          ],
        ]),
  ].map(([name, passed]) => ({ name, passed }));
}

export function sdkRoot() {
  return process.env.ANDROID_HOME ?? join(homedir(), "Library/Android/sdk");
}
export function latestBuildTools(root = sdkRoot()) {
  const dir = join(root, "build-tools");
  if (!existsSync(dir))
    throw new Error(`Android SDK build-tools missing: ${dir}`);
  const versions = readdirSync(dir)
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!versions.length)
    throw new Error(`No stable Android build-tools installed under ${dir}`);
  return join(dir, versions.at(-1));
}

export function main(args = process.argv.slice(2)) {
  if (args.length > 1)
    throw new Error(
      "Usage: node verify-apk.mjs [artifacts/Fivefold-<version>.apk]",
    );
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const app = JSON.parse(readFileSync("app.json", "utf8"));
  const apk = resolve(args[0] ?? `artifacts/Fivefold-${pkg.version}.apk`);
  if (!existsSync(apk))
    throw new Error(`APK missing. Put the signed release at ${apk}`);
  const buildTools = latestBuildTools();
  const run = (tool, argv, encoding = "utf8") => {
    const result = spawnSync(tool, argv, { encoding, maxBuffer: 80_000_000 });
    return {
      status: result.status,
      stdout: result.stdout ?? (encoding ? "" : Buffer.alloc(0)),
      stderr: result.error?.message ?? result.stderr,
    };
  };
  const signer = run(join(buildTools, "apksigner"), [
    "verify",
    "--print-certs",
    apk,
  ]);
  const alignment = run(join(buildTools, "zipalign"), [
    "-c",
    "-P",
    "16",
    "-v",
    "4",
    apk,
  ]);
  const badging = run(join(buildTools, "aapt2"), ["dump", "badging", apk]);
  const manifest = run(join(buildTools, "aapt2"), [
    "dump",
    "xmltree",
    apk,
    "--file",
    "AndroidManifest.xml",
  ]);
  const bundle = run("unzip", ["-p", apk, "assets/index.android.bundle"], null);
  const expected = expectedRelease(
    apk,
    pkg.version,
    app.expo.android.versionCode,
    args.length > 0,
  );
  const sidecar = resolve(`artifacts/Fivefold-${expected.version}.apk.sha256`);
  const gates = apkGates(
    {
      signer,
      alignment,
      badging,
      manifest,
      bundle,
      sha256: createHash("sha256").update(readFileSync(apk)).digest("hex"),
      checksum: existsSync(sidecar)
        ? readFileSync(sidecar, "utf8").trim().split(/\s+/)[0]
        : undefined,
    },
    expected,
  );
  for (const gate of gates)
    console.log(`${gate.passed ? "PASS" : "FAIL"} ${gate.name}`);
  for (const [name, result] of Object.entries({
    signer,
    alignment,
    badging,
    manifest,
    bundle,
  })) {
    if (result.status !== 0)
      console.error(
        `FAIL ${name} command: ${String(result.stderr ?? "command failed").trim()}`,
      );
  }
  return gates.every((gate) => gate.passed) ? 0 : 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}
