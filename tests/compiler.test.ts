import { mkdirSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  compile,
  reactFunctions,
  readSource,
  sourceFiles,
  type CompilerEvent,
} from "./support/compiler";

const ALLOWLIST: string[] = [];

it("compiles every app component and hook without bailouts", () => {
  expect(require("babel-plugin-react-compiler/package.json").version).toBe(
    "1.0.0",
  );
  const failures = new Set<string>();
  const report: string[] = [];
  for (const file of ["App.tsx", ...sourceFiles()]) {
    const source = readSource(file);
    const functions = reactFunctions(source, file);
    const events: CompilerEvent[] = [];
    compile(source, file, events);
    const compiled = new Set<string>();
    for (const event of events) {
      const fn = functions.find(
        (fn) =>
          fn.line === event.fnLoc?.start.line &&
          fn.column === event.fnLoc?.start.column,
      );
      const name = event.fnName ?? fn?.name;
      if (event.kind === "CompileSuccess") {
        expect(name, `${file}: unnamed compilation`).toBeTruthy();
        compiled.add(name!);
        report.push(`${file}:${name} ${event.memoSlots}`);
      } else if (
        ["CompileError", "PipelineError", "CompileSkip"].includes(event.kind)
      ) {
        if (event.kind === "CompileSkip" && fn?.optOut) continue;
        expect(name, `${file}: unlocated ${event.kind}`).toBeTruthy();
        failures.add(`${file}:${name}`);
      }
    }
    for (const fn of functions)
      expect(
        compiled.has(fn.name) || ALLOWLIST.includes(`${file}:${fn.name}`),
        `${file}:${fn.name} was not compiled`,
      ).toBe(true);
  }
  expect([...failures].sort()).toEqual([...ALLOWLIST].sort());
  const label = process.env.FIVEFOLD_PERF_LABEL ?? "current";
  if (!/^[\w-]+$/.test(label)) throw new Error("Invalid FIVEFOLD_PERF_LABEL");
  mkdirSync("artifacts/perf", { recursive: true });
  writeFileSync(
    `artifacts/perf/compiler-${label}.json`,
    JSON.stringify(
      { compiled: report.length, bailouts: [...failures], report },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `React Compiler (name memoSlots):\n${report.join("\n")}\nAllowlisted: ${[...failures].join(", ")}`,
  );
});
