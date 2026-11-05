// Tinybench measures wall time; this gate measures main-thread CPU time.
export function reportCpu<Result>(
  operation: () => Result,
  iterations = 200,
  operationsPerSample = 1,
) {
  const samples: number[] = [];

  for (let i = 0; i < iterations + 20; i++) {
    const start = process.threadCpuUsage();

    for (let operationIndex = 0; operationIndex < operationsPerSample; operationIndex++) {
      operation();
    }

    const cpu = process.threadCpuUsage(start);

    if (i >= 20) {
      samples.push((cpu.user + cpu.system) / (1000 * operationsPerSample));
    }
  }

  const sortedSamples = samples.toSorted((a, b) => a - b);

  return {
    iterations,
    operationsPerSample,
    p50CpuMs: Number(sortedSamples[Math.ceil(sortedSamples.length * 0.5) - 1].toFixed(3)),
    p95CpuMs: Number(sortedSamples[Math.ceil(sortedSamples.length * 0.95) - 1].toFixed(3)),
  };
}
