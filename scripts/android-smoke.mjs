import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Use only on a fresh QA installation. The script creates two real workout logs.
// Pass the exact launcher path and target flags returned by T3 device_open.
const [cli, ...target] = process.argv.slice(2);
if (!cli || !target.includes("--config") || !target.includes("--session"))
  throw new Error(
    "Usage: node scripts/android-smoke.mjs <agent-device launcher> <device_open target flags>",
  );
const output = resolve(
  "artifacts/qa-redesign",
  target[target.indexOf("--serial") + 1],
);
mkdirSync(output, { recursive: true });
const events = [];
function run(args) {
  const result = spawnSync(cli, [...args, ...target], {
    encoding: "utf8",
    maxBuffer: 8_000_000,
  });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  return result.stdout;
}
function snapshot(interactive = true) {
  const result = JSON.parse(
    run(["snapshot", ...(interactive ? ["-i"] : []), "--json"]),
  );
  return result.data.nodes.filter((n) => n.visibleToUser);
}
function record(message) {
  events.push({ time: new Date().toISOString(), message });
  console.log(message);
}
function findClick(predicate, scroll = false) {
  for (let attempt = 0; attempt < (scroll ? 10 : 1); attempt++) {
    const node = snapshot().find((n) => predicate(n.label || ""));
    if (node) {
      run(["click", "@" + node.ref]);
      record("Tapped " + node.label);
      return;
    }
    if (scroll) run(["scroll", "down", "0.35", "--settle"]);
  }
  throw new Error("Expected control was absent.");
}
function exact(label, scroll = false) {
  findClick((text) => text === label, scroll);
}
function expectText(text) {
  if (!snapshot(false).some((n) => (n.label || "").includes(text)))
    throw new Error("Expected text absent: " + text);
  record("Verified " + text);
}
function shot(name) {
  run(["screenshot", resolve(output, name + ".png")]);
}
function complete(count, alreadyLogged = 0) {
  let logged = alreadyLogged;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (logged === count) {
      shot("completed-" + count);
      exact("Finish");
      exact("Save workout");
      return;
    }
    const pending = snapshot().find((n) =>
      (n.label || "").includes("not logged. Tap to log 5 reps"),
    );
    if (pending) {
      run(["click", "@" + pending.ref]);
      logged++;
    } else run(["scroll", "down", "0.35", "--settle"]);
  }
  throw new Error("Workout could not be completed in 60 actions.");
}

try {
  run(["open", "app.fivefold.lifts"]);
  if (!snapshot().some((n) => (n.label || "") === "Start workout A")) {
    // This script owns its QA workout; discard it before replaying A → B.
    if (snapshot().some((n) => (n.label || "") === "Finish")) {
      exact("Discard", true);
      exact("Discard workout");
    }
    if (snapshot().some((n) => (n.label || "") === "Start workout B"))
      exact("Switch A / B");
  }
  findClick((s) => s === "Start workout A", true);
  findClick((s) => s.includes("Squat, set 1 of 5, not logged"));
  expectText("1 / 15 sets");
  shot("active-workout");
  run(["close", "app.fivefold.lifts"]);
  run(["open", "app.fivefold.lifts"]);
  expectText("1 / 15 sets");
  record("Restart preserved the first set");
  // A second tap opens an explicit editor instead of silently losing a rep.
  findClick((s) => s.includes("Squat, set 1 of 5, 5 of 5 reps"));
  expectText("Currently: 5 reps");
  exact("3 reps");
  findClick((s) => s.includes("Squat, set 1 of 5, 3 of 5 reps"));
  exact("0 reps");
  findClick((s) => s.includes("Squat, set 1 of 5, 0 of 5 reps"));
  exact("Clear set");
  findClick((s) => s.includes("Squat, set 1 of 5, not logged"));
  record("Explicit correction, zero reps and clear passed");
  complete(15, 1);
  findClick((s) => s === "Start workout B", true);
  complete(11);
  exact("History");
  findClick((s) => s.startsWith("Open workout B,"));
  expectText("Workout B");
  shot("history-detail");
  run(["back"]);
  exact("Progress");
  expectText("Lift records");
  shot("progress");
  exact("Train");
  findClick((s) => s === "Start workout A", true);
  expectText("Last:");
  record("A → B → A, deadlift 1×5, history, progress and restart passed");
  writeFileSync(
    resolve(output, "smoke-result.json"),
    JSON.stringify({ status: "passed", events }, null, 2),
  );
} catch (error) {
  try {
    shot("failure");
  } catch {
    /* Best-effort failure evidence. */
  }
  writeFileSync(
    resolve(output, "smoke-result.json"),
    JSON.stringify({ status: "failed", error: String(error), events }, null, 2),
  );
  throw error;
}
