import { performance } from "node:perf_hooks";
import { getProgressOverview } from "./src/domain/progress";
import {
  initialState,
  startSession,
  type Session,
} from "./src/domain/workout";

// Development CPU budgets, separate from release-device frame/startup profiling.
// Structural regressions (bounded output, cache invalidation, one history pass,
// and no history writes per set) are covered by Vitest.
const template = startSession(initialState(), 1).active!;
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
  samples.sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];
const cpuP95 = p95(cpuSamples);
getProgressOverview(history, "kg");
const cachedStart = process.threadCpuUsage();
for (let i = 0; i < 1000; i++) getProgressOverview(history, "kg");
const cached = process.threadCpuUsage(cachedStart);
const cachedMs = (cached.user + cached.system) / 1000;
const result = {
  fixtureSessions: history.length,
  environment: `${process.platform}/${process.arch}, Node ${process.versions.node}`,
  coldSummaryCpuP95Ms: Number(cpuP95.toFixed(3)),
  coldSummaryWallP95Ms: Number(p95(wallSamples).toFixed(3)),
  cached1000CallsCpuMs: Number(cachedMs.toFixed(3)),
  budgets: { coldSummaryCpuP95Ms: 16, cached1000CallsCpuMs: 8 },
};
console.log(JSON.stringify(result, null, 2));
if (
  cpuP95 > result.budgets.coldSummaryCpuP95Ms ||
  cachedMs > result.budgets.cached1000CallsCpuMs
) {
  throw new Error(
    "Progress CPU budget exceeded. Investigate before shipping; do not silently raise the budget.",
  );
}
