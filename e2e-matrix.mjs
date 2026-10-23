import { execFileSync, spawn } from "node:child_process";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { sdkRoot } from "./verify-apk.mjs";

export function matrixAvds(value) {
  const names = (value ?? "Pixel_API_35,Agents_Android_17_API_37_2")
    .split(",")
    .map((name) => name.trim());
  if (names.some((name) => !name) || new Set(names).size !== names.length)
    throw new Error(
      "FIVEFOLD_E2E_AVDS must contain distinct, nonempty AVD names",
    );
  return names;
}
export function deviceSerials(output) {
  return output
    .split(/\r?\n/)
    .flatMap(
      (line) =>
        /^([^\s]+)\s+(?:device|offline|unauthorized)\b/.exec(line)?.[1] ?? [],
    );
}
export function emulatorArguments(name, port) {
  if (!Number.isInteger(port) || port < 5560 || port > 5680 || port % 2 !== 0)
    throw new Error("Matrix emulator port must be even, from 5560 to 5680");
  return [
    "-avd",
    name,
    "-port",
    String(port),
    "-read-only",
    "-no-snapshot-save",
    "-no-boot-anim",
    "-no-audio",
  ];
}
export function assertAvdStopped(name, running) {
  const existing = running.find((device) => device.name === name);
  if (existing)
    throw new Error(
      `${name} is already running as ${existing.serial}; stop it yourself before running the matrix. It will not be reused or killed.`,
    );
}
async function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
async function freePort(adb) {
  const occupied = new Set(deviceSerials(adb(["devices"])));
  for (let port = 5560; port <= 5680; port += 2) {
    if (
      !occupied.has(`emulator-${port}`) &&
      (await portFree(port)) &&
      (await portFree(port + 1))
    )
      return port;
  }
  throw new Error("No free even emulator console port from 5560 to 5680");
}
async function waitForBoot(adb, serial, child) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Emulator exited with ${child.exitCode} before boot`);
    try {
      if (
        adb(["-s", serial, "shell", "getprop", "sys.boot_completed"]).trim() ===
        "1"
      )
        return;
    } catch {
      /* Device not online yet. */
    }
    await delay(1000);
  }
  throw new Error(`${serial} did not boot within 240 seconds`);
}
function runTests(serial, log, reportDirectory) {
  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      ["run", "test:e2e", "--output", reportDirectory],
      {
        env: { ...process.env, E2E_DEVICE: serial },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.on("data", (data) => {
      process.stdout.write(data);
      log.write(data);
    });
    child.stderr.on("data", (data) => {
      process.stderr.write(data);
      log.write(data);
    });
    child.once("error", (error) => {
      log.write(String(error));
      resolve(1);
    });
    child.once("close", (code) => resolve(code ?? 1));
  });
}
export async function main() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const apk = resolve(
    process.env.FIVEFOLD_APK ?? `artifacts/Fivefold-${pkg.version}.apk`,
  );
  if (!existsSync(apk))
    throw new Error(`Signed APK missing: put it at ${apk} or set FIVEFOLD_APK`);
  const root = sdkRoot();
  const adbPath = join(root, "platform-tools/adb");
  const adb = (args) =>
    execFileSync(adbPath, args, {
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const avds = matrixAvds(process.env.FIVEFOLD_E2E_AVDS);
  const out = resolve(`artifacts/release-${pkg.version}`);
  mkdirSync(out, { recursive: true });
  let failed = false;
  for (const name of avds) {
    const started = Date.now();
    let serial,
      child,
      log,
      api = "unknown",
      counts = "tests not run",
      ownsDevice = false;
    try {
      // Read-only does not make simultaneous copies of one AVD safe. Refuse it.
      const runningAvds = deviceSerials(adb(["devices"]))
        .filter((serial) => serial.startsWith("emulator-"))
        .map((serial) => ({
          serial,
          name: adb(["-s", serial, "emu", "avd", "name"])
            .split(/\r?\n/)[0]
            .trim(),
        }));
      assertAvdStopped(name, runningAvds);
      const port = await freePort(adb);
      serial = `emulator-${port}`;
      child = spawn(
        join(root, "emulator/emulator"),
        emulatorArguments(name, port),
        { stdio: "ignore" },
      );
      let spawnError;
      child.once("error", (error) => {
        spawnError = error;
      });
      await new Promise((resolve) =>
        child.once("spawn", resolve).once("error", resolve),
      );
      if (spawnError) throw spawnError;
      ownsDevice = true;
      await waitForBoot(adb, serial, child);
      api = adb([
        "-s",
        serial,
        "shell",
        "getprop",
        "ro.build.version.sdk",
      ]).trim();
      const release = adb([
        "-s",
        serial,
        "shell",
        "getprop",
        "ro.build.version.release",
      ]).trim();
      const logPath = join(out, `e2e-android${api}.log`);
      log = createWriteStream(logPath);
      log.write(`AVD ${name}, ${serial}, Android ${release}, API ${api}\n`);
      log.write(adb(["-s", serial, "install", "-r", apk]));
      const reportDirectory = resolve(`.e2e/matrix-${serial}-${Date.now()}`);
      const code = await runTests(serial, log, reportDirectory);
      const report = JSON.parse(
        readFileSync(join(reportDirectory, "report.json"), "utf8"),
      );
      const summary = report.run.summary;
      counts = `${summary.passed} passed / ${summary.failed} failed / ${summary.skipped} skipped`;
      if (code !== 0 || report.run.exitCode !== 0)
        throw new Error(`E2E failed (exit ${code})`);
      console.log(
        `PASS ${name}: API ${api}, ${counts}, ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    } catch (error) {
      failed = true;
      console.error(
        `FAIL ${name}: API ${api}, ${counts}, ${((Date.now() - started) / 1000).toFixed(1)}s — ${error.message}`,
      );
      log?.write(`FAIL ${error.message}\n`);
    } finally {
      if (log) await new Promise((resolve) => log.end(resolve));
      if (ownsDevice && child?.exitCode === null) {
        try {
          adb(["-s", serial, "emu", "kill"]);
        } catch (error) {
          failed = true;
          console.error(`FAIL cleanup ${serial}: ${error.message}`);
        }
      }
    }
  }
  return failed ? 1 : 0;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}
