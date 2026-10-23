import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

const execute = promisify(execFile);

const PACKAGE = "app.fivefold.lifts";

const ACTIVITY = `${PACKAGE}/.MainActivity`;

const USAGE =
  "Usage: pnpm exec tsx measure-device.ts --serial emulator-5554 --apk <path> --label baseline [--starts 15] [--workouts 3]";

type MeasureOptions = {
  serial: string;
  apk: string;
  label: string;
  starts: number;
  workouts: number;
};

type PerfEvent = {
  name: string;
  ms: number;
  [key: string]: string | number | boolean | null;
};

type SequencedPerfEvent = PerfEvent & { sequence: number };

type UiNode = {
  text: string;
  description: string;
  enabled: boolean;
  bounds: { left: number; top: number; right: number; bottom: number };
  x: number;
  y: number;
};

type Viewport = { width: number; height: number };

type GfxInfo = {
  totalFrames: number;
  jankyFrames: number;
  jankyPercent: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
};

type StartupMeasurement = {
  totalTimeMs: number;
  waitTimeMs: number;
  loadMs: number;
  readyMs: number;
};

type CommitMeasurement = { workout: number; set: string; saveMs: number; renderMs: number };

type WorkoutMeasurement = { kind: "A" | "B"; sets: number; gfxinfo: GfxInfo };

type MeasurementSummary = {
  totalTimeMs: ReturnType<typeof summarize>;
  waitTimeMs: ReturnType<typeof summarize>;
  "startup.load": ReturnType<typeof summarize>;
  "startup.ready": ReturnType<typeof summarize>;
  "commit.save": ReturnType<typeof summarize>;
  "commit.render": ReturnType<typeof summarize>;
};

type MeasurementResult = {
  label: string;
  serial: string;
  apk: string;
  measuredAt: string;
  device: { model: string; android: string; fingerprint: string };
  seed: SequencedPerfEvent | null;
  pssKb: number;
  summary: MeasurementSummary;
  starts: StartupMeasurement[];
  commits: CommitMeasurement[];
  workouts: WorkoutMeasurement[];
};

interface SummaryStats {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

interface StartupTiming {
  totalTimeMs: number;
  waitTimeMs: number;
}

const PerformanceEventSchema = z
  .object({
    name: z.string(),
    ms: z.number().finite().nonnegative(),
  })
  .catchall(z.union([z.string(), z.number(), z.boolean(), z.null()]));

const StreamChunkSchema = z.union([z.instanceof(Buffer), z.string()]);

function streamText(chunk: Buffer | string): string {
  return Buffer.isBuffer(chunk) ? chunk.toString("utf8") : z.string().parse(chunk);
}

function errorDetail(error: Error): string {
  const stderr = "stderr" in error ? StreamChunkSchema.safeParse(error.stderr) : undefined;

  if (stderr?.success) {
    return streamText(stderr.data);
  }

  return error.message;
}

export function percentile(values: number[], quantile: number): number {
  if (!values.length) {
    throw new Error("Cannot summarize empty samples");
  }

  if (quantile < 0 || quantile > 1) {
    throw new Error("Invalid percentile");
  }

  const sorted = values.toSorted((a, b) => a - b);

  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

export function summarize(values: number[]): SummaryStats {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

export function parseAmStart(output: string): StartupTiming {
  const total = output.match(/^TotalTime:\s*(\d+)\s*$/m);
  const wait = output.match(/^WaitTime:\s*(\d+)\s*$/m);

  if (!/^Status:\s*ok\s*$/m.test(output) || !total || !wait || /Error:/i.test(output)) {
    throw new Error(`Could not parse am start -W output: ${output}`);
  }

  return { totalTimeMs: Number(total[1]), waitTimeMs: Number(wait[1]) };
}

export function parseGfxinfo(output: string): GfxInfo {
  const total = output.match(/Total frames rendered:\s*(\d+)/);
  const janky = output.match(/Janky frames:\s*(\d+)\s*\(([\d.]+)%\)/);
  const percentiles = new Map<number, number>();

  for (const n of [50, 90, 95, 99]) {
    const match = output.match(new RegExp(`${n}th percentile:\\s*(\\d+(?:\\.\\d+)?)ms`));

    if (!match) {
      throw new Error(`Missing gfxinfo ${n}th percentile`);
    }

    percentiles.set(n, Number(match[1]));
  }

  if (!total || !janky) {
    throw new Error("Missing gfxinfo frame totals");
  }

  return {
    totalFrames: Number(total[1]),
    jankyFrames: Number(janky[1]),
    jankyPercent: Number(janky[2]),
    p50Ms: percentiles.get(50) ?? 0,
    p90Ms: percentiles.get(90) ?? 0,
    p95Ms: percentiles.get(95) ?? 0,
    p99Ms: percentiles.get(99) ?? 0,
  };
}

export function parsePss(output: string): number {
  // App Summary on current Android; older versions expose the tabular TOTAL row.
  const match = output.match(/TOTAL PSS:\s*([\d,]+)/) ?? output.match(/^\s*TOTAL\s+([\d,]+)/m);

  if (!match) {
    throw new Error("Missing TOTAL PSS in dumpsys meminfo");
  }

  return Number(match[1].replaceAll(",", ""));
}

export function parsePerfLine(line: string): PerfEvent | null {
  const offset = line.indexOf("FIVEFOLD_PERF ");

  if (offset < 0) {
    return null;
  }

  try {
    return PerformanceEventSchema.parse(
      JSON.parse(line.slice(offset + "FIVEFOLD_PERF ".length).trim()),
    );
  } catch {
    return null;
  }
}

const xmlEntities = new Map([
  ["quot", '"'],
  ["apos", "'"],
  ["lt", "<"],
  ["gt", ">"],
  ["amp", "&"],
]);

const decodeXml = (value: string): string =>
  value.replaceAll(/&(#x[\da-f]+|#\d+|quot|apos|lt|gt|amp);/gi, (_, entity: string) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    }

    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number(entity.slice(1)));
    }

    return xmlEntities.get(entity) ?? "";
  });

export function parseUiNodes(xml: string): UiNode[] {
  if (!xml.includes("<hierarchy") || !xml.includes("</hierarchy>")) {
    throw new Error("Invalid uiautomator XML");
  }

  return [...xml.matchAll(/<node\b([^>]*)>/g)].map((match) => {
    const attributes = new Map(
      [...(match[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)].map((entry) => [
        entry[1] ?? "",
        decodeXml(entry[2] ?? ""),
      ]),
    );

    const bounds = attributes.get("bounds")?.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);

    if (!bounds) {
      throw new Error(`Invalid UI bounds: ${attributes.get("bounds") ?? "missing"}`);
    }

    const [left = 0, top = 0, right = 0, bottom = 0] = bounds.slice(1).map(Number);

    return {
      text: attributes.get("text") ?? "",
      description: attributes.get("content-desc") ?? "",
      enabled: attributes.get("enabled") !== "false",
      bounds: { left, top, right, bottom },
      x: Math.round((left + right) / 2),
      y: Math.round((top + bottom) / 2),
    };
  });
}

export function parseArguments(args: string[]): MeasureOptions {
  const options: MeasureOptions = { serial: "", apk: "", label: "", starts: 15, workouts: 3 };

  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];

    if (!flag?.startsWith("--") || !value) {
      throw new Error(USAGE);
    }

    const name = flag.slice(2);

    if (name === "serial" || name === "apk" || name === "label") {
      options[name] = value;
    } else if (name === "starts" || name === "workouts") {
      const count = Number(value);

      if (!Number.isSafeInteger(count) || count < 1) {
        throw new Error(`--${name} must be a positive integer`);
      }

      options[name] = count;
    } else {
      throw new Error(USAGE);
    }
  }

  if (!options.serial || !options.apk || !/^[\w-]+$/.test(options.label ?? "")) {
    throw new Error(USAGE);
  }

  return options;
}

async function findAdb(): Promise<string> {
  try {
    await execute("adb", ["version"]);

    return "adb";
  } catch {
    const androidHome = z.string().optional().parse(process.env.ANDROID_HOME);

    if (androidHome) {
      const adb = join(
        androidHome,
        "platform-tools",
        process.platform === "win32" ? "adb.exe" : "adb",
      );

      await access(adb, constants.X_OK);

      return adb;
    }

    throw new Error("adb was not found on PATH; set ANDROID_HOME or add platform-tools to PATH");
  }
}

function visible(node: UiNode, dimensions: Viewport): boolean {
  return (
    node.enabled &&
    node.bounds.right > node.bounds.left &&
    node.bounds.bottom > node.bounds.top &&
    node.x > 0 &&
    node.x < dimensions.width &&
    node.y > dimensions.height * 0.1 &&
    node.y < dimensions.height * 0.88
  );
}

function sequential<Value>(
  values: readonly Value[],
  action: (value: Value) => Promise<void>,
): Promise<void> {
  return values.reduce((previous, value) => previous.then(() => action(value)), Promise.resolve());
}

export async function main(args: string[] = process.argv.slice(2)): Promise<MeasurementResult> {
  const options = parseArguments(args);
  await access(options.apk, constants.R_OK);
  const adb = await findAdb();
  const prefix = ["-s", options.serial];

  const command = async (...commandArgs: string[]): Promise<string> => {
    try {
      const { stdout, stderr } = await execute(adb, [...prefix, ...commandArgs], {
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });

      return stdout + stderr;
    } catch (failure) {
      const error = z.instanceof(Error).safeParse(failure);
      const detail = error.success ? errorDetail(error.data) : "Unknown adb error";

      throw new Error(`adb ${commandArgs.join(" ")} failed: ${detail}`, { cause: failure });
    }
  };

  await command("get-state");
  await command("uninstall", PACKAGE).catch(() => {});
  const installed = await command("install", "-r", resolve(options.apk));

  if (!installed.includes("Success")) {
    throw new Error(`APK install failed: ${installed}`);
  }

  await command("logcat", "-c");
  const events: SequencedPerfEvent[] = [];
  let streamError: string | undefined;
  let partial = "";

  const logcat: ChildProcess = spawn(
    adb,
    [...prefix, "logcat", "-v", "brief", "ReactNativeJS:V", "*:S"],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  logcat.on("error", (error) => {
    streamError = error.message;
  });
  logcat.on("exit", (code) => {
    streamError = `logcat exited (${code === null ? "without an exit code" : code.toString()})`;
  });
  logcat.stderr?.on("data", (data) => {
    process.stderr.write(streamText(StreamChunkSchema.parse(data)));
  });
  logcat.stdout?.on("data", (data) => {
    partial += streamText(StreamChunkSchema.parse(data));
    const lines = partial.split(/\r?\n/);
    partial = lines.pop() ?? "";

    for (const line of lines) {
      const event = parsePerfLine(line);

      if (event) {
        events.push({ ...event, sequence: events.length });
      }
    }
  });

  function waitPerf(
    name: string,
    after: number,
    timeout = 10_000,
    deadline = Date.now() + timeout,
  ): Promise<SequencedPerfEvent> {
    const found = events.slice(after).find((event) => event.name === name);

    if (found) {
      return Promise.resolve(found);
    }

    if (streamError) {
      return Promise.reject(new Error(streamError));
    }

    if (Date.now() >= deadline) {
      return Promise.reject(
        new Error(
          `Timed out after ${timeout / 1000}s waiting for ${name}. ${events.length ? "Check the measurement build/logcat output." : "No FIVEFOLD_PERF line appeared: rebuild the APK with EXPO_PUBLIC_FIVEFOLD_PERF=1 (and EXPO_PUBLIC_FIVEFOLD_SEED=10000 for the baseline)."}`,
        ),
      );
    }

    return delay(100).then(() => waitPerf(name, after, timeout, deadline));
  }

  async function dump(attempt = 0): Promise<UiNode[]> {
    try {
      const result = await command("shell", "uiautomator", "dump", "/sdcard/fivefold-window.xml");

      if (/ERROR|could not get idle state/i.test(result)) {
        throw new Error(result);
      }

      return parseUiNodes(await command("exec-out", "cat", "/sdcard/fivefold-window.xml"));
    } catch (cause) {
      if (attempt >= 5) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`UI dump failed after 6 attempts: ${detail}`, { cause });
      }

      await delay(400 * (attempt + 1));

      return dump(attempt + 1);
    }
  }

  // Use the display, not the dumped nodes: a dialog dump only spans the
  // dialog window, which would put its buttons outside the "visible" band.
  // An "Override size" line, when present, follows "Physical size".
  const display = [...(await command("shell", "wm", "size")).matchAll(/(\d+)x(\d+)/g)].at(-1);

  if (!display?.[1] || !display[2]) {
    throw new Error("Could not parse the Android display size.");
  }

  const displayWidth = Number(display[1]);
  const displayHeight = Number(display[2]);

  function viewport(): Viewport {
    return { width: displayWidth, height: displayHeight };
  }

  const tap = (node: UiNode): Promise<string> =>
    command("shell", "input", "tap", String(node.x), String(node.y));

  async function swipe(direction: "down" | "up"): Promise<void> {
    const { width, height } = viewport();
    await command(
      "shell",
      "input",
      "swipe",
      String(Math.round(width * 0.5)),
      String(Math.round(height * (direction === "down" ? 0.73 : 0.28))),
      String(Math.round(width * 0.5)),
      String(Math.round(height * (direction === "down" ? 0.28 : 0.73))),
      "350",
    );
    await delay(300);
  }

  async function findAndTap(pattern: RegExp, attempt = 0): Promise<UiNode> {
    if (attempt >= 14) {
      throw new Error(`UI target not found after scrolling: ${pattern.toString()}`);
    }

    const nodes = await dump();

    const found = nodes.find(
      (node) =>
        visible(node, viewport()) && (pattern.test(node.description) || pattern.test(node.text)),
    );

    if (found) {
      await tap(found);

      return found;
    }

    await swipe(attempt < 7 ? "down" : "up");

    return findAndTap(pattern, attempt + 1);
  }

  try {
    await command("shell", "am", "start", "-W", "-n", ACTIVITY);
    await waitPerf("startup.ready", 0, 120_000);
    const seed = events.find((event) => event.name === "startup.seed");
    const starts: StartupMeasurement[] = [];

    await sequential(
      Array.from({ length: options.starts }, (_, index) => index + 1),
      async (index) => {
        await command("shell", "am", "force-stop", PACKAGE);
        await command("logcat", "-c");
        const after = events.length;
        const timing = parseAmStart(await command("shell", "am", "start", "-W", "-n", ACTIVITY));
        const ready = await waitPerf("startup.ready", after, 120_000);

        const load = events
          .slice(after, ready.sequence + 1)
          .find((event) => event.name === "startup.load");

        if (!load) {
          throw new Error("startup.ready arrived without startup.load");
        }

        starts.push({ ...timing, loadMs: load.ms, readyMs: ready.ms });
        process.stdout.write(
          `Cold start ${index}/${options.starts}: ready ${ready.ms.toFixed(1)} ms, TotalTime ${timing.totalTimeMs} ms\n`,
        );
      },
    );

    await delay(5000);
    const pssKb = parsePss(await command("shell", "dumpsys", "meminfo", PACKAGE));
    const workouts: WorkoutMeasurement[] = [];
    const commits: CommitMeasurement[] = [];

    const pendingSet =
      /^(Squat|Bench press|Barbell row|Overhead press|Deadlift), set (\d+) of (\d+), not logged/;

    await sequential(
      Array.from({ length: options.workouts }, (_, index) => index),
      async (workout) => {
        const beforeStart = events.length;
        const start = await findAndTap(/^Start workout [AB]$/);
        await waitPerf("commit.render", beforeStart);
        const kind: "A" | "B" = (start.description || start.text).endsWith("B") ? "B" : "A";
        const expected = kind === "A" ? 15 : 11;
        await command("shell", "dumpsys", "gfxinfo", PACKAGE, "reset");
        const tapped = new Set();

        async function logNextSet(misses = 0): Promise<void> {
          if (tapped.size >= expected) {
            return;
          }

          const nodes = await dump();
          const dimensions = viewport();

          const target = nodes.find(
            (node) =>
              visible(node, dimensions) &&
              pendingSet.test(node.description) &&
              !tapped.has(node.description.match(pendingSet)?.[0] ?? ""),
          );

          if (!target) {
            if (misses >= 16) {
              throw new Error(
                `Only found ${tapped.size}/${expected} set buttons in workout ${workout + 1}`,
              );
            }

            await swipe((misses + 1) % 12 < 7 ? "down" : "up");

            return logNextSet(misses + 1);
          }

          const setName = target.description.match(pendingSet)?.[0];

          if (!setName) {
            throw new Error("Set button no longer matches the pending-set pattern");
          }

          const after = events.length;
          await tap(target);
          const rendered = await waitPerf("commit.render", after);

          const saved = events
            .slice(after, rendered.sequence + 1)
            .find((event) => event.name === "commit.save");

          if (!saved) {
            throw new Error("Set tap committed without commit.save timing");
          }

          commits.push({
            workout: workout + 1,
            set: target.description,
            saveMs: saved.ms,
            renderMs: rendered.ms,
          });
          tapped.add(setName);

          return logNextSet();
        }

        await logNextSet();

        await delay(500);
        const gfxinfo = parseGfxinfo(await command("shell", "dumpsys", "gfxinfo", PACKAGE));
        workouts.push({ kind, sets: tapped.size, gfxinfo });
        await findAndTap(/^Discard$/);
        const after = events.length;
        await findAndTap(/^Discard workout$/);
        await waitPerf("commit.render", after);
        process.stdout.write(
          `Workout ${workout + 1}/${options.workouts}: ${tapped.size} set taps, ${gfxinfo.jankyFrames}/${gfxinfo.totalFrames} janky frames\n`,
        );
      },
    );

    const result: MeasurementResult = {
      label: options.label,
      serial: options.serial,
      apk: resolve(options.apk),
      measuredAt: new Date().toISOString(),
      device: {
        model: (await command("shell", "getprop", "ro.product.model")).trim(),
        android: (await command("shell", "getprop", "ro.build.version.release")).trim(),
        fingerprint: (await command("shell", "getprop", "ro.build.fingerprint")).trim(),
      },
      seed: seed ?? null,
      pssKb,
      summary: {
        totalTimeMs: summarize(starts.map((start) => start.totalTimeMs)),
        waitTimeMs: summarize(starts.map((start) => start.waitTimeMs)),
        "startup.load": summarize(starts.map((start) => start.loadMs)),
        "startup.ready": summarize(starts.map((start) => start.readyMs)),
        "commit.save": summarize(commits.map((commit) => commit.saveMs)),
        "commit.render": summarize(commits.map((commit) => commit.renderMs)),
      },
      starts,
      commits,
      workouts,
    };

    await mkdir("artifacts/perf", { recursive: true });
    await writeFile(
      `artifacts/perf/device-${options.label}.json`,
      JSON.stringify(result, null, 2) + "\n",
    );
    process.stdout.write(
      JSON.stringify(
        {
          summary: result.summary,
          pssKb,
          gfxinfo: workouts.map((workout) => workout.gfxinfo),
        },
        null,
        2,
      ) + "\n",
    );

    return result;
  } finally {
    logcat.kill();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
