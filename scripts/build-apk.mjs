import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const androidHome =
  process.env.ANDROID_HOME || join(homedir(), "Library/Android/sdk");
const env = {
  ...process.env,
  ANDROID_HOME: androidHome,
  NODE_ENV: "production",
};
function run(cmd, args, cwd = root) {
  const result = spawnSync(cmd, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${cmd} exited with status ${result.status}`);
}
run("npm", ["run", "check"]);
if (!process.argv.includes("--skip-prebuild")) {
  run("npx", ["expo", "prebuild", "--platform", "android", "--no-install"]);
}
run(
  "./gradlew",
  [
    ":app:assembleRelease",
    "--console=plain",
    "--max-workers=4",
  ],
  join(root, "android"),
);
// Keep the release identity outside the repository. Reuse it for every update.
const identity = join(homedir(), ".local/share/fivefold/signing");
mkdirSync(identity, { recursive: true, mode: 0o700 });
chmodSync(identity, 0o700);
const passwordFile = join(identity, "password");
const keystore = join(identity, "release.jks");
if (!existsSync(passwordFile))
  writeFileSync(passwordFile, randomBytes(32).toString("hex"), { mode: 0o600 });
if (!existsSync(keystore)) {
  run("keytool", [
    "-genkeypair",
    "-keystore",
    keystore,
    "-storetype",
    "PKCS12",
    "-alias",
    "fivefold",
    "-keyalg",
    "RSA",
    "-keysize",
    "3072",
    "-validity",
    "10000",
    "-dname",
    "CN=Fivefold, OU=Personal Apps, O=Fivefold",
    "-storepass:file",
    passwordFile,
    "-keypass:file",
    passwordFile,
  ]);
  chmodSync(keystore, 0o600);
}
const buildTools = join(
  androidHome,
  "build-tools",
  readdirSync(join(androidHome, "build-tools"))
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1),
);
const out = join(root, "artifacts");
mkdirSync(out, { recursive: true });
const version = JSON.parse(readFileSync(join(root, "app.json"), "utf8")).expo
  .version;
const filename = `Fivefold-${version}.apk`;
const apk = join(out, filename);
run(join(buildTools, "apksigner"), [
  "sign",
  "--ks",
  keystore,
  "--ks-key-alias",
  "fivefold",
  "--ks-pass",
  `file:${passwordFile}`,
  "--out",
  apk,
  join(root, "android/app/build/outputs/apk/release/app-release.apk"),
]);
run(join(buildTools, "apksigner"), [
  "verify",
  "--verbose",
  "--print-certs",
  apk,
]);
run(join(buildTools, "zipalign"), ["-c", "-P", "16", "4", apk]);
const sha = createHash("sha256").update(readFileSync(apk)).digest("hex");
writeFileSync(join(out, `${filename}.sha256`), `${sha}  ${filename}\n`);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
writeFileSync(
  join(out, "build-info.json"),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      apk,
      sha256: sha,
      expo: pkg.dependencies.expo,
      reactNative: pkg.dependencies["react-native"],
      expoUI: pkg.dependencies["@expo/ui"],
      signingIdentityDirectory: identity,
    },
    null,
    2,
  ) + "\n",
);
console.log(`\nAPK ready: ${apk}\nSHA-256: ${sha}`);
