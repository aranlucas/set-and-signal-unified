import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as babel from "@babel/core";
import type { NodePath } from "@babel/core";
import type { Function as BabelFunction, Node as BabelNode } from "@babel/types";
import { requireValue } from "./require-value";

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

interface ReactFunctionInfo {
  name: string;
  line: number;
  column: number;
  optOut: boolean;
}

function declaredName(node: BabelNode | undefined): string | undefined {
  if (babel.types.isFunctionDeclaration(node) || babel.types.isFunctionExpression(node)) {
    return node.id?.name;
  }

  if (babel.types.isVariableDeclarator(node) && babel.types.isIdentifier(node.id)) {
    return node.id.name;
  }

  if (babel.types.isClassDeclaration(node) || babel.types.isClassExpression(node)) {
    return node.id?.name;
  }

  return undefined;
}

function functionName(path: NodePath<BabelFunction>): string | undefined {
  return declaredName(path.node) ?? declaredName(path.parentPath?.node);
}

export function sourceFiles(directory = "src"): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (path === "src/widgets") {
      return [];
    }

    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

export function reactFunctions(source: string, filename: string): ReactFunctionInfo[] {
  const functions: ReactFunctionInfo[] = [];

  const ast = requireValue(
    babel.parseSync(source, {
      filename,
      configFile: false,
      babelrc: false,
      presets: ["@babel/preset-typescript"],
    }),
    `Babel did not parse ${filename}`,
  );

  babel.traverse(ast, {
    Function(path) {
      const name = functionName(path);

      if (!name || !/^([A-Z]|use[A-Z])/.test(name)) {
        return;
      }

      const location = requireValue(path.node.loc, `Babel did not locate ${name} in ${filename}`);
      const body = path.node.body;

      functions.push({
        name,
        line: location.start.line,
        column: location.start.column,
        optOut:
          babel.types.isBlockStatement(body) &&
          body.directives.some((directive) =>
            compilerOptions.customOptOutDirectives.includes(directive.value.value),
          ),
      });
    },
  });

  return functions;
}

export function compile(source: string, filename: string, events?: CompilerEvent[]): string {
  const result = babel.transformSync(source, {
    filename,
    configFile: false,
    babelrc: false,
    presets: ["@babel/preset-typescript"],
    plugins: [
      [
        "babel-plugin-react-compiler",
        {
          ...compilerOptions,
          logger: {
            logEvent: (_filename: string, event: CompilerEvent) => events?.push(event),
          },
        },
      ],
    ],
  });

  return requireValue(result?.code, `Babel did not compile ${filename}`);
}

export function instrument(source: string, filename: string): string {
  // A separate pass keeps the invocation counter outside compiler memoization.
  const result = babel.transformSync(compile(source, filename), {
    filename,
    configFile: false,
    babelrc: false,
    plugins: [
      () => ({
        visitor: {
          Function(path: NodePath<BabelFunction>) {
            const name = functionName(path);

            if (!name || !/^[A-Z]/.test(name)) {
              return;
            }

            if (!babel.types.isBlockStatement(path.node.body)) {
              path.node.body = babel.types.blockStatement([
                babel.types.returnStatement(path.node.body),
              ]);
            }

            path.node.body.body.unshift(
              babel.types.expressionStatement(
                babel.types.optionalCallExpression(
                  babel.types.memberExpression(
                    babel.types.identifier("globalThis"),
                    babel.types.identifier("fivefoldRenderCounter"),
                  ),
                  [babel.types.stringLiteral(name)],
                  true,
                ),
              ),
            );
          },
        },
      }),
      ["@babel/plugin-transform-react-jsx", { runtime: "automatic" }],
    ],
  });

  return requireValue(result?.code, `Babel did not instrument ${filename}`);
}

export const readSource = (filename: string) => readFileSync(filename, "utf8");
