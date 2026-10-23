import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import type { WriteStream } from "node:fs";
import { createServer } from "node:net";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { parseJson } from "./tests/support/parse-json";
import { sdkRoot } from "./verify-apk";

type RunningAvd = { name: string; serial: string };

type AdbCommand = (args: string[]) => string;

const E2eReportSchema = z.object({
  run: z.object({
    exitCode: z.number(),
    summary: z.object({ passed: z.number(), failed: z.number(), skipped: z.number() }),
  }),
});

const ProjectVersionSchema = z.object({ version: z.string() });

const MatrixEnvironmentSchema = z.object({
  FIVEFOLD_APK: z.string().optional(),
  FIVEFOLD_E2E_AVDS: z.string().optional(),
});

const StreamChunkSchema = z.union([z.instanceof(Buffer), z.string()]);

function streamText(chunk: Buffer | string): string {
  return Buffer.isBuffer(chunk) ? chunk.toString("utf8") : z.string().parse(chunk);
}

export function matrixAvds(
  value: string | undefined = z.string().optional().parse(process.env.FIVEFOLD_E2E_AVDS),
): string[] {
  const names = (value ?? "Pixel_API_35,Agents_Android_17_API_37_2")
    .split(",")
    .map((name: string) => name.trim());

  if (names.some((name) => !name) || new Set(names).size !== names.length) {
    throw new Error("FIVEFOLD_E2E_AVDS must contain distinct, nonempty AVD names");
  }

  return names;
}

export function deviceSerials(output: string): string[] {
  return output
    .split(/\r?\n/)
    .flatMap(
      (line: string) => /^([^\s]+)\s+(?:device|offline|unauthorized)\b/.exec(line)?.[1] ?? [],
    );
}

export function emulatorArguments(name: string, port: number): string[] {
  if (!Number.isInteger(port) || port < 5560 || port > 5680 || port % 2 !== 0) {
    throw new Error("Matrix emulator port must be even, from 5560 to 5680");
  }

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

export function assertAvdStopped(name: string, running: RunningAvd[]): void {
  const existing = running.find((device) => device.name === name);

  if (existing) {
    throw new Error(
      `${name} is already running as ${existing.serial}; stop it yourself before running the matrix. It will not be reused or killed.`,
    );
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function freePort(adb: AdbCommand): Promise<number> {
  const occupied = new Set(deviceSerials(adb(["devices"])));
  const ports = Array.from({ length: 61 }, (_, index) => 5560 + index * 2);

  const available = await ports.reduce<Promise<number | null>>(
    (search, port) =>
      search.then(async (found) => {
        if (found !== null || occupied.has(`emulator-${port}`)) {
          return found;
        }

        if (!(await portFree(port)) || !(await portFree(port + 1))) {
          return null;
        }

        return port;
      }),
    Promise.resolve<number | null>(null),
  );

  if (available !== null) {
    return available;
  }

  throw new Error("No free even emulator console port from 5560 to 5680");
}

function waitForBoot(
  adb: AdbCommand,
  serial: string,
  child: ChildProcess,
  deadline = Date.now() + 240_000,
): Promise<void> {
  if (child.exitCode !== null) {
    return Promise.reject(new Error(`Emulator exited with ${child.exitCode} before boot`));
  }

  try {
    if (adb(["-s", serial, "shell", "getprop", "sys.boot_completed"]).trim() === "1") {
      return Promise.resolve();
    }
  } catch {
    // The device is not online yet.
  }

  if (Date.now() >= deadline) {
    return Promise.reject(new Error(`${serial} did not boot within 240 seconds`));
  }

  return delay(1000).then(() => waitForBoot(adb, serial, child, deadline));
}

function runTests(serial: string, log: WriteStream, reportDirectory: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn("pnpm", ["run", "test:e2e", "--output", reportDirectory], {
      env: { ...process.env, E2E_DEVICE: serial },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (data) => {
      const output = streamText(StreamChunkSchema.parse(data));
      process.stdout.write(output);
      log.write(output);
    });
    child.stderr.on("data", (data) => {
      const output = streamText(StreamChunkSchema.parse(data));
      process.stderr.write(output);
      log.write(output);
    });
    child.once("error", (error) => {
      log.write(String(error));
      resolve(1);
    });
    child.once("close", (code) => resolve(code ?? 1));
  });
}

export async function main(): Promise<number> {
  const pkg = parseJson(readFileSync("package.json", "utf8"), ProjectVersionSchema);
  const environment = MatrixEnvironmentSchema.parse(process.env);
  const apk = resolvePath(environment.FIVEFOLD_APK ?? `artifacts/Fivefold-${pkg.version}.apk`);

  if (!existsSync(apk)) {
    throw new Error(`Signed APK missing: put it at ${apk} or set FIVEFOLD_APK`);
  }

  const root = sdkRoot();
  const adbPath = join(root, "platform-tools/adb");

  const adb: AdbCommand = (args) =>
    execFileSync(adbPath, args, {
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"],
    });

  const avds = matrixAvds(environment.FIVEFOLD_E2E_AVDS);
  const out = resolvePath(`artifacts/release-${pkg.version}`);
  mkdirSync(out, { recursive: true });
  let failed = false;

  await avds.reduce((sequence, name) => sequence.then(() => runAvd(name)), Promise.resolve());

  return failed ? 1 : 0;

  async function runAvd(name: string): Promise<void> {
    const started = Date.now();

    let serial: string | undefined;
    let child: ChildProcess | undefined;
    let log: WriteStream | undefined;
    let api = "unknown";
    let counts = "tests not run";
    let ownsDevice = false;
    let spawnError: Error | undefined;

    try {
      // Read-only does not make simultaneous copies of one AVD safe. Refuse it.
      const runningAvds = deviceSerials(adb(["devices"]))
        .filter((deviceId) => deviceId.startsWith("emulator-"))
        .map((deviceId) => ({
          serial: deviceId,
          name: adb(["-s", deviceId, "emu", "avd", "name"]).split(/\r?\n/)[0]?.trim() ?? "",
        }));

      assertAvdStopped(name, runningAvds);
      const port = await freePort(adb);
      serial = `emulator-${port}`;
      child = spawn(join(root, "emulator/emulator"), emulatorArguments(name, port), {
        stdio: "ignore",
      });
      child.once("error", (error) => {
        spawnError = error;
      });
      await new Promise<void>((resolve) => {
        child?.once("spawn", () => resolve());
        child?.once("error", () => resolve());
      });

      if (spawnError) {
        throw spawnError;
      }

      ownsDevice = true;
      await waitForBoot(adb, serial, child);
      api = adb(["-s", serial, "shell", "getprop", "ro.build.version.sdk"]).trim();
      const release = adb(["-s", serial, "shell", "getprop", "ro.build.version.release"]).trim();
      const logPath = join(out, `e2e-android${api}.log`);
      log = createWriteStream(logPath);
      log.write(`AVD ${name}, ${serial}, Android ${release}, API ${api}\n`);
      log.write(adb(["-s", serial, "install", "-r", apk]));
      const reportDirectory = resolvePath(`.e2e/matrix-${serial}-${Date.now()}`);
      const code = await runTests(serial, log, reportDirectory);

      const report = parseJson(
        readFileSync(join(reportDirectory, "report.json"), "utf8"),
        E2eReportSchema,
      );

      const summary = report.run.summary;
      counts = `${summary.passed} passed / ${summary.failed} failed / ${summary.skipped} skipped`;

      if (code !== 0 || report.run.exitCode !== 0) {
        throw new Error(`E2E failed (exit ${code})`);
      }

      process.stdout.write(
        `PASS ${name}: API ${api}, ${counts}, ${((Date.now() - started) / 1000).toFixed(1)}s\n`,
      );
    } catch (error) {
      failed = true;
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `FAIL ${name}: API ${api}, ${counts}, ${((Date.now() - started) / 1000).toFixed(1)}s — ${detail}\n`,
      );
      log?.write(`FAIL ${detail}\n`);
    } finally {
      if (log) {
        await new Promise<void>((resolve) => {
          log?.end(() => resolve());
        });
      }

      if (ownsDevice && child && serial && child.exitCode === null) {
        try {
          adb(["-s", serial, "emu", "kill"]);
        } catch (error) {
          failed = true;
          const detail = error instanceof Error ? error.message : String(error);
          process.stderr.write(`FAIL cleanup ${serial}: ${detail}\n`);
        }
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`FAIL ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
