import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { z } from "zod";
import {
  compile,
  reactFunctions,
  readSource,
  sourceFiles,
  type CompilerEvent,
} from "./support/compiler";
import { parseJson } from "./support/parse-json";
import { requireValue } from "./support/require-value";

const ALLOWLIST: string[] = [];

const CompilerPackageSchema = z.object({ version: z.string() });

it("compiles every app component and hook without bailouts", () => {
  const compilerPackage = parseJson(
    readFileSync("node_modules/babel-plugin-react-compiler/package.json", "utf8"),
    CompilerPackageSchema,
  );

  expect(compilerPackage.version).toBe("1.0.0");
  const failures = new Set<string>();
  const report: string[] = [];

  for (const file of ["app.tsx", ...sourceFiles()]) {
    const source = readSource(file);
    const functions = reactFunctions(source, file);
    const events: CompilerEvent[] = [];
    compile(source, file, events);
    const compiled = new Set<string>();

    for (const event of events) {
      const fn = functions.find(
        (candidate) =>
          candidate.line === event.fnLoc?.start.line &&
          candidate.column === event.fnLoc?.start.column,
      );

      const name = event.fnName ?? fn?.name;

      if (event.kind === "CompileSuccess") {
        expect(name, `${file}: unnamed compilation`).toBeTruthy();

        const compiledName = requireValue(name, `${file}: CompileSuccess has no function name`);

        const memoSlots = requireValue(
          event.memoSlots,
          `${file}:${compiledName} has no memo slot count`,
        );

        compiled.add(compiledName);
        report.push(`${file}:${compiledName} ${memoSlots}`);
      } else if (["CompileError", "PipelineError", "CompileSkip"].includes(event.kind)) {
        if (event.kind === "CompileSkip" && fn?.optOut) {
          continue;
        }

        expect(name, `${file}: unlocated ${event.kind}`).toBeTruthy();
        failures.add(
          `${file}:${requireValue(name, `${file}: ${event.kind} has no function name`)}`,
        );
      }
    }

    for (const fn of functions) {
      expect(
        compiled.has(fn.name) || ALLOWLIST.includes(`${file}:${fn.name}`),
        `${file}:${fn.name} was not compiled`,
      ).toBe(true);
    }
  }

  expect([...failures].toSorted()).toEqual([...ALLOWLIST].toSorted());
  const label = z.string().default("current").parse(process.env.FIVEFOLD_PERF_LABEL);

  if (!/^[\w-]+$/.test(label)) {
    throw new Error("Invalid FIVEFOLD_PERF_LABEL");
  }

  mkdirSync("artifacts/perf", { recursive: true });
  writeFileSync(
    `artifacts/perf/compiler-${label}.json`,
    JSON.stringify({ compiled: report.length, bailouts: [...failures], report }, null, 2) + "\n",
  );
  process.stdout.write(
    `React Compiler (name memoSlots):\n${report.join("\n")}\nAllowlisted: ${[...failures].join(", ")}\n`,
  );
});
