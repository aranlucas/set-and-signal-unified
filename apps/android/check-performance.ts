import { loadPlates, PLATE_SIZES } from "./src/domain/plates";
import { sessionDate, workoutDate } from "./src/domain/format";
import { mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { validateState } from "./src/domain/backup";
import { nextSetLabel, notificationProps, widgetProps } from "./src/domain/surfaces";
import { finishedHistory, NOW } from "./tests/support/fixture";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { getProgressOverview } from "./src/domain/progress";
import { requireValue } from "./tests/support/require-value";
import {
  initialState,
  logSet,
  formatWeight,
  startSession,
  loggedSets,
  totalSets,
  type AppState,
  type Session,
} from "./src/domain/workout";

// Development CPU budgets, separate from release-device frame/startup profiling.
// Structural regressions (bounded output, cache invalidation, one history pass,
// and no history writes per set) are covered by Vitest.
const template = requireValue(startSession(initialState("kg"), 1).active);

const history: Session[] = Array.from({ length: 10_000 }, (_, i) => ({
  ...template,
  id: `performance-${i}`,
  startedAt: 1 + i * 60_000,
  finishedAt: 60_000 + i * 60_000,
  exercises: template.exercises.map((exercise) => ({
    ...exercise,
    weight: 20 + (i % 100) * 2.5,
    sets: [5, 5, 5, 5, i % 3 ? 5 : 3],
  })),
}));

const cpuSamples: number[] = [];

const wallSamples: number[] = [];

for (let i = 0; i < 24; i++) {
  const input = [...history]; // Clone outside the timed summary operation.
  const start = performance.now();
  const cpuStart = process.threadCpuUsage();
  getProgressOverview(input, "kg");
  const cpu = process.threadCpuUsage(cpuStart);
  const elapsed = performance.now() - start;

  if (i >= 4) {
    cpuSamples.push((cpu.user + cpu.system) / 1000);
    wallSamples.push(elapsed);
  }
}

const p95 = (samples: number[]) =>
  samples.toSorted((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];

const cpuP95 = p95(cpuSamples);

getProgressOverview(history, "kg");

const cachedStart = process.threadCpuUsage();

for (let i = 0; i < 1000; i++) {
  getProgressOverview(history, "kg");
}

const cached = process.threadCpuUsage(cachedStart);

const cachedMs = (cached.user + cached.system) / 1000;

function reportCpu<Result>(operation: () => Result, iterations = 200) {
  const samples: number[] = [];

  for (let i = 0; i < iterations + 20; i++) {
    const start = process.threadCpuUsage();
    operation();
    const cpu = process.threadCpuUsage(start);

    if (i >= 20) {
      samples.push((cpu.user + cpu.system) / 1000);
    }
  }

  const sortedSamples = samples.toSorted((a, b) => a - b);

  return {
    iterations,
    p50CpuMs: Number(sortedSamples[Math.ceil(sortedSamples.length * 0.5) - 1].toFixed(3)),
    p95CpuMs: Number(sortedSamples[Math.ceil(sortedSamples.length * 0.95) - 1].toFixed(3)),
  };
}

const measurementState = {
  ...initialState("kg"),
  onboarded: true,
  history: finishedHistory(),
};

// Exercise the enabled notification path so the benchmark includes its formatting.
const activeState = startSession(
  {
    ...measurementState,
    settings: { ...measurementState.settings, restAlerts: true },
  },
  NOW,
);

const rows = measurementState.history.map((session) => JSON.stringify(session));

const savedRow = JSON.stringify({ ...measurementState, history: [] });

const dateOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
} as const;

const numberFormatter = new Intl.NumberFormat();

const dateFormatter = new Intl.DateTimeFormat(undefined, dateOptions);

const cachedWeight = (n: number) => numberFormatter.format(Number(n.toFixed(2)));

const values = Array.from({ length: 1000 }, (_, i) => i * 1.2345);

const dates = Array.from({ length: 1000 }, (_, i) => NOW - i * 86_400_000);

for (const n of [0, -0, -12.345, 20, 22.5, 1234.567, 4410]) {
  assert.equal(cachedWeight(n), formatWeight(n));
}

for (const t of dates.slice(0, 10)) {
  assert.equal(
    dateFormatter.format(new Date(t)),
    new Date(t).toLocaleDateString(undefined, dateOptions),
  );
}

const dateSessions = dates.map((finishedAt) => ({ ...template, finishedAt }));

const benchmarks = {
  setTapPipeline: reportCpu(() => {
    const state = logSet(activeState, "squat", 0, 5, NOW);
    JSON.stringify({ ...state, history: [] });
    JSON.stringify(widgetProps(state, new Date(NOW)));
    JSON.stringify(notificationProps(state, NOW));
    nextSetLabel(state.active);
    // The mounted subscriptions select existing slices/primitives. No note or
    // history rendering runs on a set tap; the changed exercise formats its load.
    const active = requireValue(state.active);
    loggedSets(active);
    totalSets(active);

    for (const lift of ["squat", "bench", "row"] as const) {
      active.exercises.find((exercise) => exercise.lift === lift);
      state.history.find((session) => session.exercises.some((exercise) => exercise.lift === lift));
    }

    formatWeight(active.exercises[0].weight);
    workoutDate(active.startedAt);
  }),
  startupHydrate: reportCpu(() => {
    // SAFETY: savedRow was serialized above from measurementState, a valid AppState fixture.
    const saved = JSON.parse(savedRow) as AppState;
    // SAFETY: each row was serialized above from a Session in measurementState.history.
    const workoutHistory = rows.map((json) => JSON.parse(json) as Session);

    return validateState({ ...saved, history: workoutHistory });
  }),
  formatting: {
    note: "Node only; indicative for Hermes. Each iteration formats 1,000 weights and 1,000 dates.",
    current: reportCpu(() => {
      for (const n of values) {
        formatWeight(n);
      }

      for (const session of dateSessions) {
        sessionDate(session);
      }
    }),
    cachedIntl: reportCpu(() => {
      for (const n of values) {
        cachedWeight(n);
      }

      for (const t of dates) {
        dateFormatter.format(new Date(t));
      }
    }),
  },
};

const maxInventory = {
  kg: PLATE_SIZES.kg.map(() => 20),
  lb: PLATE_SIZES.lb.map(() => 20),
};

// No cache: every timed call solves the full maximum inventory and reconstructs
// its result at the app's maximum kilogram target, including the above option.
const plateSolver = reportCpu(() => loadPlates(2000, 20, "kg", maxInventory), 1000);

const result = {
  plateSolver,

  fixtureSessions: history.length,
  environment: [process.platform, process.arch, "Node", requireValue(process.versions.node)].join(
    " ",
  ),
  coldSummaryCpuP95Ms: Number(cpuP95.toFixed(3)),
  coldSummaryWallP95Ms: Number(p95(wallSamples).toFixed(3)),
  cached1000CallsCpuMs: Number(cachedMs.toFixed(3)),
  budgets: {
    coldSummaryCpuP95Ms: 16,
    cached1000CallsCpuMs: 8,
    plateSolverCpuP95Ms: 1,
  },
  reportOnly: benchmarks,
};

const label = z.string().default("current").parse(process.env.FIVEFOLD_PERF_LABEL);

if (!/^[\w-]+$/.test(label)) {
  throw new Error("Invalid FIVEFOLD_PERF_LABEL");
}

mkdirSync("artifacts/perf", { recursive: true });

writeFileSync(`artifacts/perf/cpu-${label}.json`, JSON.stringify(result, null, 2) + "\n");

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (
  plateSolver.p95CpuMs >= result.budgets.plateSolverCpuP95Ms ||
  cpuP95 > result.budgets.coldSummaryCpuP95Ms ||
  cachedMs > result.budgets.cached1000CallsCpuMs
) {
  throw new Error(
    "CPU budget exceeded. Investigate before shipping; do not silently raise the budget.",
  );
}
