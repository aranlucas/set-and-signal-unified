import { execFile, spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const execute = promisify(execFile);
const PACKAGE = "app.fivefold.lifts";
const ACTIVITY = `${PACKAGE}/.MainActivity`;
const USAGE =
  "Usage: node measure-device.mjs --serial emulator-5554 --apk <path> --label baseline [--starts 15] [--workouts 3]";

export function percentile(values, quantile) {
  if (!values.length) throw new Error("Cannot summarize empty samples");
  if (quantile < 0 || quantile > 1) throw new Error("Invalid percentile");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}
export function summarize(values) {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}
export function parseAmStart(output) {
  const total = output.match(/^TotalTime:\s*(\d+)\s*$/m);
  const wait = output.match(/^WaitTime:\s*(\d+)\s*$/m);
  if (
    !/^Status:\s*ok\s*$/m.test(output) ||
    !total ||
    !wait ||
    /Error:/i.test(output)
  )
    throw new Error(`Could not parse am start -W output: ${output}`);
  return { totalTimeMs: Number(total[1]), waitTimeMs: Number(wait[1]) };
}
export function parseGfxinfo(output) {
  const total = output.match(/Total frames rendered:\s*(\d+)/);
  const janky = output.match(/Janky frames:\s*(\d+)\s*\(([\d.]+)%\)/);
  const percentiles = {};
  for (const n of [50, 90, 95, 99]) {
    const match = output.match(
      new RegExp(`${n}th percentile:\\s*(\\d+(?:\\.\\d+)?)ms`),
    );
    if (!match) throw new Error(`Missing gfxinfo ${n}th percentile`);
    percentiles[`p${n}Ms`] = Number(match[1]);
  }
  if (!total || !janky) throw new Error("Missing gfxinfo frame totals");
  return {
    totalFrames: Number(total[1]),
    jankyFrames: Number(janky[1]),
    jankyPercent: Number(janky[2]),
    ...percentiles,
  };
}
export function parsePss(output) {
  // App Summary on current Android; older versions expose the tabular TOTAL row.
  const match =
    output.match(/TOTAL PSS:\s*([\d,]+)/) ??
    output.match(/^\s*TOTAL\s+([\d,]+)/m);
  if (!match) throw new Error("Missing TOTAL PSS in dumpsys meminfo");
  return Number(match[1].replaceAll(",", ""));
}
export function parsePerfLine(line) {
  const offset = line.indexOf("FIVEFOLD_PERF ");
  if (offset < 0) return null;
  try {
    const event = JSON.parse(
      line.slice(offset + "FIVEFOLD_PERF ".length).trim(),
    );
    if (
      typeof event.name !== "string" ||
      !Number.isFinite(event.ms) ||
      event.ms < 0
    )
      return null;
    return event;
  } catch {
    return null;
  }
}
const decodeXml = (value) =>
  value.replace(/&(#x[\da-f]+|#\d+|quot|apos|lt|gt|amp);/gi, (_, entity) => {
    if (entity.startsWith("#x"))
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#"))
      return String.fromCodePoint(Number(entity.slice(1)));
    return { quot: '"', apos: "'", lt: "<", gt: ">", amp: "&" }[entity];
  });
export function parseUiNodes(xml) {
  if (!xml.includes("<hierarchy") || !xml.includes("</hierarchy>"))
    throw new Error("Invalid uiautomator XML");
  return [...xml.matchAll(/<node\b([^>]*)>/g)].map((match) => {
    const attributes = Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((entry) => [
        entry[1],
        decodeXml(entry[2]),
      ]),
    );
    const bounds = attributes.bounds?.match(
      /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/,
    );
    if (!bounds) throw new Error(`Invalid UI bounds: ${attributes.bounds}`);
    const [left, top, right, bottom] = bounds.slice(1).map(Number);
    return {
      text: attributes.text ?? "",
      description: attributes["content-desc"] ?? "",
      enabled: attributes.enabled !== "false",
      bounds: { left, top, right, bottom },
      x: Math.round((left + right) / 2),
      y: Math.round((top + bottom) / 2),
    };
  });
}
export function parseArguments(args) {
  const options = { starts: 15, workouts: 3 };
  const allowed = new Set(["serial", "apk", "label", "starts", "workouts"]);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, "");
    if (!args[i].startsWith("--") || !allowed.has(key) || !args[i + 1])
      throw new Error(USAGE);
    options[key] = ["starts", "workouts"].includes(key)
      ? Number(args[i + 1])
      : args[i + 1];
  }
  if (!options.serial || !options.apk || !/^[\w-]+$/.test(options.label ?? ""))
    throw new Error(USAGE);
  for (const key of ["starts", "workouts"])
    if (!Number.isSafeInteger(options[key]) || options[key] < 1)
      throw new Error(`--${key} must be a positive integer`);
  return options;
}
async function findAdb() {
  try {
    await execute("adb", ["version"]);
    return "adb";
  } catch {
    if (process.env.ANDROID_HOME) {
      const adb = join(
        process.env.ANDROID_HOME,
        "platform-tools",
        process.platform === "win32" ? "adb.exe" : "adb",
      );
      await access(adb, constants.X_OK);
      return adb;
    }
    throw new Error(
      "adb was not found on PATH; set ANDROID_HOME or add platform-tools to PATH",
    );
  }
}
export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  await access(options.apk, constants.R_OK);
  const adb = await findAdb();
  const prefix = ["-s", options.serial];
  const command = async (...args) => {
    try {
      const { stdout, stderr } = await execute(adb, [...prefix, ...args], {
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      return stdout + stderr;
    } catch (error) {
      throw new Error(
        `adb ${args.join(" ")} failed: ${error.stderr ?? error.message}`,
        { cause: error },
      );
    }
  };
  await command("get-state");
  await command("uninstall", PACKAGE).catch(() => {});
  const installed = await command("install", "-r", resolve(options.apk));
  if (!/Success/.test(installed))
    throw new Error(`APK install failed: ${installed}`);
  await command("logcat", "-c");
  const events = [];
  let streamError;
  let partial = "";
  const logcat = spawn(
    adb,
    [...prefix, "logcat", "-v", "brief", "ReactNativeJS:V", "*:S"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  logcat.on("error", (error) => {
    streamError = error.message;
  });
  logcat.on("exit", (code) => {
    streamError = `logcat exited (${code})`;
  });
  logcat.stderr.on("data", (data) => {
    process.stderr.write(data);
  });
  logcat.stdout.on("data", (data) => {
    partial += data.toString();
    const lines = partial.split(/\r?\n/);
    partial = lines.pop() ?? "";
    for (const line of lines) {
      const event = parsePerfLine(line);
      if (event) events.push({ ...event, sequence: events.length });
    }
  });
  const waitPerf = async (name, after, timeout = 10_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = events.slice(after).find((event) => event.name === name);
      if (found) return found;
      if (streamError) throw new Error(streamError);
      await delay(100);
    }
    throw new Error(
      `Timed out after ${timeout / 1000}s waiting for ${name}. ${events.length ? "Check the measurement build/logcat output." : "No FIVEFOLD_PERF line appeared: rebuild the APK with EXPO_PUBLIC_FIVEFOLD_PERF=1 (and EXPO_PUBLIC_FIVEFOLD_SEED=10000 for the baseline)."}`,
    );
  };
  async function dump() {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const result = await command(
          "shell",
          "uiautomator",
          "dump",
          "/sdcard/fivefold-window.xml",
        );
        if (/ERROR|could not get idle state/i.test(result))
          throw new Error(result);
        return parseUiNodes(
          await command("exec-out", "cat", "/sdcard/fivefold-window.xml"),
        );
      } catch (error) {
        if (attempt === 5)
          throw new Error(`UI dump failed after 6 attempts: ${error.message}`, {
            cause: error,
          });
        await delay(400 * (attempt + 1));
      }
    }
  }
  // Use the display, not the dumped nodes: a dialog dump only spans the
  // dialog window, which would put its buttons outside the "visible" band.
  // An "Override size" line, when present, follows "Physical size".
  const [, displayWidth, displayHeight] = [
    ...(await command("shell", "wm", "size")).matchAll(/(\d+)x(\d+)/g),
  ]
    .at(-1)
    .map(Number);
  function viewport() {
    return { width: displayWidth, height: displayHeight };
  }
  function visible(node, dimensions) {
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
  const tap = (node) =>
    command("shell", "input", "tap", String(node.x), String(node.y));
  async function swipe(nodes, direction) {
    const { width, height } = viewport(nodes);
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
  async function findAndTap(pattern) {
    for (let attempt = 0; attempt < 14; attempt++) {
      const nodes = await dump();
      const dimensions = viewport(nodes);
      const found = nodes.find(
        (node) =>
          visible(node, dimensions) &&
          (pattern.test(node.description) || pattern.test(node.text)),
      );
      if (found) {
        await tap(found);
        return found;
      }
      await swipe(nodes, attempt < 7 ? "down" : "up");
    }
    throw new Error(`UI target not found after scrolling: ${pattern}`);
  }
  try {
    await command("shell", "am", "start", "-W", "-n", ACTIVITY);
    await waitPerf("startup.ready", 0, 120_000);
    const seed = events.find((event) => event.name === "startup.seed");
    const starts = [];
    for (let i = 0; i < options.starts; i++) {
      await command("shell", "am", "force-stop", PACKAGE);
      await command("logcat", "-c");
      const after = events.length;
      const timing = parseAmStart(
        await command("shell", "am", "start", "-W", "-n", ACTIVITY),
      );
      const ready = await waitPerf("startup.ready", after, 120_000);
      const load = events
        .slice(after, ready.sequence + 1)
        .find((event) => event.name === "startup.load");
      if (!load) throw new Error("startup.ready arrived without startup.load");
      starts.push({ ...timing, loadMs: load.ms, readyMs: ready.ms });
      console.log(
        `Cold start ${i + 1}/${options.starts}: ready ${ready.ms.toFixed(1)} ms, TotalTime ${timing.totalTimeMs} ms`,
      );
    }
    await delay(5000);
    const pssKb = parsePss(
      await command("shell", "dumpsys", "meminfo", PACKAGE),
    );
    const workouts = [];
    const commits = [];
    const pendingSet =
      /^(Squat|Bench press|Barbell row|Overhead press|Deadlift), set (\d+) of (\d+), not logged/;
    for (let workout = 0; workout < options.workouts; workout++) {
      const beforeStart = events.length;
      const start = await findAndTap(/^Start workout [AB]$/);
      await waitPerf("commit.render", beforeStart);
      const kind = (start.description || start.text).endsWith("B") ? "B" : "A";
      const expected = kind === "A" ? 15 : 11;
      await command("shell", "dumpsys", "gfxinfo", PACKAGE, "reset");
      const tapped = new Set();
      let misses = 0;
      while (tapped.size < expected) {
        const nodes = await dump();
        const dimensions = viewport(nodes);
        const target = nodes.find(
          (node) =>
            visible(node, dimensions) &&
            pendingSet.test(node.description) &&
            !tapped.has(node.description.match(pendingSet)[0]),
        );
        if (!target) {
          if (++misses > 16)
            throw new Error(
              `Only found ${tapped.size}/${expected} set buttons in workout ${workout + 1}`,
            );
          await swipe(nodes, misses % 12 < 7 ? "down" : "up");
          continue;
        }
        misses = 0;
        const after = events.length;
        await tap(target);
        const rendered = await waitPerf("commit.render", after);
        const saved = events
          .slice(after, rendered.sequence + 1)
          .find((event) => event.name === "commit.save");
        if (!saved)
          throw new Error("Set tap committed without commit.save timing");
        commits.push({
          workout: workout + 1,
          set: target.description,
          saveMs: saved.ms,
          renderMs: rendered.ms,
        });
        tapped.add(target.description.match(pendingSet)[0]);
      }
      await delay(500);
      const gfxinfo = parseGfxinfo(
        await command("shell", "dumpsys", "gfxinfo", PACKAGE),
      );
      workouts.push({ kind, sets: tapped.size, gfxinfo });
      await findAndTap(/^Discard$/);
      const after = events.length;
      await findAndTap(/^Discard workout$/);
      await waitPerf("commit.render", after);
      console.log(
        `Workout ${workout + 1}/${options.workouts}: ${tapped.size} set taps, ${gfxinfo.jankyFrames}/${gfxinfo.totalFrames} janky frames`,
      );
    }
    const result = {
      label: options.label,
      serial: options.serial,
      apk: resolve(options.apk),
      measuredAt: new Date().toISOString(),
      device: {
        model: (await command("shell", "getprop", "ro.product.model")).trim(),
        android: (
          await command("shell", "getprop", "ro.build.version.release")
        ).trim(),
        fingerprint: (
          await command("shell", "getprop", "ro.build.fingerprint")
        ).trim(),
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
    console.log(
      JSON.stringify(
        {
          summary: result.summary,
          pssKb,
          gfxinfo: workouts.map((workout) => workout.gfxinfo),
        },
        null,
        2,
      ),
    );
    return result;
  } finally {
    logcat.kill();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
