import { act, type ReactElement } from "react";
import { createRoot, type Root, type TestInstance, type TestNode } from "test-renderer";

declare global {
  var fivefoldRenderCounter: ((name: string) => void) | undefined;
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

interface SemanticsProperties {
  contentDescription?: string;
}

interface ModifierDescriptor {
  name: string;
  args: readonly unknown[];
}

interface NativeHostProps {
  contentDescription?: string;
  enabled?: boolean;
  horizontalAlignment?: string;
  modifiers?: readonly ModifierDescriptor[];
  onClick?: () => void;
  onValueChange?: (value: string) => void;
  selected?: boolean;
  value?: { get(): string };
}

const roots = new Set<Root>();

export { act };

export type { Root, TestInstance };

export function render(element: ReactElement): Root {
  const root = createRoot();
  roots.add(root);
  act(() => root.render(element));

  return root;
}

export function unmount(root: Root): void {
  if (roots.delete(root)) {
    act(() => root.unmount());
  }
}

export function cleanup(): void {
  if (roots.size > 0) {
    const mountedRoots = [...roots];
    roots.clear();
    act(() => {
      for (const root of mountedRoots) {
        root.unmount();
      }
    });
  }
}

export function text(node: TestNode): string {
  if (!hasChildren(node)) {
    return node;
  }

  return node.children.map(text).join("");
}

function hasChildren(node: TestNode): node is TestInstance {
  return node instanceof Object && "children" in node;
}

export function hostProps(node: TestInstance): NativeHostProps {
  // SAFETY: the native component adapters forward these declared props to Test Renderer host
  // nodes; all access to its intentionally generic `props` surface is centralized here.
  return node.props as NativeHostProps;
}

export function modifier(node: TestInstance, name: string): ModifierDescriptor | undefined {
  return hostProps(node).modifiers?.find((entry) => entry.name === name);
}

export function modifierAction(
  node: TestInstance,
  name: "clickable" | "toggleable",
  argumentIndex: number,
): () => void {
  const action = modifier(node, name)?.args[argumentIndex];

  if (!action) {
    throw new TypeError(`Missing ${name} modifier callback`);
  }

  // SAFETY: clickable and toggleable adapters store action functions at these declared argument
  // positions, and this helper invokes only those positions.
  return action as () => void;
}

export function semanticDescription(node: TestInstance): string {
  const value = modifier(node, "semantics")?.args[0];

  if (value === null || value === undefined) {
    return "";
  }

  // SAFETY: the semantics adapter receives this declared property object from app components.
  return (value as SemanticsProperties).contentDescription ?? "";
}

export function hostCallback(node: TestInstance, name: "onClick"): () => void;
export function hostCallback(node: TestInstance, name: "onValueChange"): (value: string) => void;
export function hostCallback(
  node: TestInstance,
  name: "onClick" | "onValueChange",
): (() => void) | ((value: string) => void) {
  const callback = hostProps(node)[name];

  if (!callback) {
    throw new TypeError(`Missing native ${name} callback`);
  }

  return callback;
}
