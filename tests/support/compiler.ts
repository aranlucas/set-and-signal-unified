import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const babel = require("@babel/core");
export const compilerOptions = {
  target: "19",
  panicThreshold: "NONE",
  environment: { enableResetCacheOnSourceFileChanges: false },
  customOptOutDirectives: ["widget", "use no memo", "use no forget"],
};
export type CompilerEvent = {
  kind: string;
  fnName?: string;
  fnLoc?: { start: { line: number; column: number } };
  memoSlots?: number;
  detail?: { options?: { reason?: string } };
  reason?: string;
};
export function sourceFiles(directory = "src"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (path === "src/widgets") return [];
    return entry.isDirectory()
      ? sourceFiles(path)
      : /\.tsx?$/.test(path)
        ? [path]
        : [];
  });
}
export function reactFunctions(source: string, filename: string) {
  const functions: {
    name: string;
    line: number;
    column: number;
    optOut: boolean;
  }[] = [];
  const ast = babel.parseSync(source, {
    filename,
    configFile: false,
    babelrc: false,
    presets: ["@babel/preset-typescript"],
  });
  require("@babel/traverse").default(ast, {
    Function(path: any) {
      const name = path.node.id?.name ?? path.parentPath.node.id?.name;
      if (!name || !/^([A-Z]|use[A-Z])/.test(name)) return;
      functions.push({
        name,
        line: path.node.loc.start.line,
        column: path.node.loc.start.column,
        optOut:
          path.node.body.directives?.some((d: any) =>
            compilerOptions.customOptOutDirectives.includes(d.value.value),
          ) ?? false,
      });
    },
  });
  return functions;
}
export function compile(
  source: string,
  filename: string,
  events?: CompilerEvent[],
) {
  return babel.transformSync(source, {
    filename,
    configFile: false,
    babelrc: false,
    presets: ["@babel/preset-typescript"],
    plugins: [
      [
        require("babel-plugin-react-compiler"),
        {
          ...compilerOptions,
          logger: {
            logEvent: (_filename: string, event: CompilerEvent) =>
              events?.push(event),
          },
        },
      ],
    ],
  }).code as string;
}
export function instrument(source: string, filename: string) {
  // A separate pass keeps the invocation counter outside compiler memoization.
  return babel.transformSync(compile(source, filename), {
    filename,
    configFile: false,
    babelrc: false,
    plugins: [
      ({ types: t }: any) => ({
        visitor: {
          Function(path: any) {
            const name = path.node.id?.name ?? path.parentPath.node.id?.name;
            if (!name || !/^[A-Z]/.test(name)) return;
            if (!t.isBlockStatement(path.node.body))
              path.node.body = t.blockStatement([
                t.returnStatement(path.node.body),
              ]);
            path.node.body.body.unshift(
              t.expressionStatement(
                t.optionalCallExpression(
                  t.memberExpression(
                    t.identifier("globalThis"),
                    t.identifier("__FIVEFOLD_RENDER__"),
                  ),
                  [t.stringLiteral(name)],
                  true,
                ),
              ),
            );
          },
        },
      }),
      [require("@babel/plugin-transform-react-jsx"), { runtime: "automatic" }],
    ],
  }).code as string;
}
export const readSource = (filename: string) => readFileSync(filename, "utf8");
