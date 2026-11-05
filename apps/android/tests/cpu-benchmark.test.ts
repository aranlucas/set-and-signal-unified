import { afterEach, expect, it, vi } from "vitest";
import { reportCpu } from "./support/cpu-benchmark";

afterEach(() => vi.restoreAllMocks());

function quantizedOperation(costMicros: number) {
  let elapsed = 0;
  vi.spyOn(process, "threadCpuUsage").mockImplementation((previous) => ({
    user: Math.floor(elapsed / 1000) * 1000 - (previous?.user ?? 0),
    system: 0,
  }));

  return vi.fn(() => {
    elapsed += costMicros;
  });
}

it("resolves sub-millisecond CPU work with a millisecond-resolution clock", () => {
  const operation = quantizedOperation(100);
  const result = reportCpu(operation, 1000, 20);

  expect(result.p95CpuMs).toBeCloseTo(0.1, 3);
  expect(operation).toHaveBeenCalledTimes(1020 * 20);
});

it("keeps CPU work above the one-millisecond budget above the threshold", () => {
  const operation = quantizedOperation(2000);

  expect(reportCpu(operation, 1000, 20).p95CpuMs).toBeGreaterThanOrEqual(1);
});
