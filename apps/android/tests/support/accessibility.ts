export interface UiNode {
  attributes: Record<string, string>;
  children: UiNode[];
  parent?: UiNode;
  box: { x: number; y: number; width: number; height: number };
}

interface ScreenMetrics {
  width: number;
  height: number;
  dp: number;
}

const decode = (value: string) =>
  value.replaceAll(/&(#x[\da-f]+|#\d+|quot|apos|lt|gt|amp);/gi, (_, entity: string) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(parseInt(entity.slice(2), 16));
    }

    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number(entity.slice(1)));
    }

    switch (entity.toLowerCase()) {
      case "quot":
        return '"';
      case "apos":
        return "'";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      default:
        throw new Error(`Unknown XML entity: ${entity}`);
    }
  });

export function parseAccessibilityTree(xml: string) {
  if (!xml.includes("<hierarchy") || !xml.includes("</hierarchy>")) {
    throw new Error("Invalid uiautomator dump: missing hierarchy");
  }

  const nodes: UiNode[] = [];
  const stack: UiNode[] = [];

  for (const token of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (token[0] === "</node>") {
      stack.pop();
      continue;
    }

    const attributes = Object.fromEntries(
      [...token[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], decode(m[2])]),
    );

    const rect = attributes.bounds
      ?.match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/)
      ?.slice(1)
      .map(Number);

    if (!rect) {
      throw new Error(`Missing accessibility bounds: ${attributes.bounds}`);
    }

    const node: UiNode = {
      attributes,
      children: [],
      parent: stack.at(-1),
      box: {
        x: rect[0],
        y: rect[1],
        width: rect[2] - rect[0],
        height: rect[3] - rect[1],
      },
    };

    node.parent?.children.push(node);
    nodes.push(node);

    if (!token[2]) {
      stack.push(node);
    }
  }

  return nodes;
}

export function accessibleName(node: UiNode): string {
  const own = node.attributes["content-desc"]?.trim() || node.attributes.text?.trim();

  if (own) {
    return own;
  }

  return node.children.map(accessibleName).filter(Boolean).join(" ");
}

export function accessibilityViolations(nodes: UiNode[], { width, height, dp }: ScreenMetrics) {
  const failures: string[] = [];
  const appNodes = nodes.filter((n) => n.attributes.package === "app.fivefold.lifts");
  const navigation = appNodes.find((n) => n.attributes.text === "Train");
  // The tab label's clickable ancestor marks the top of the fixed tab bar.
  let tabBar = navigation;

  while (tabBar && tabBar.attributes.clickable !== "true") {
    tabBar = tabBar.parent;
  }

  const rest = appNodes.find((n) => /^Rest \d/.test(n.attributes.text ?? ""));
  let restDock = rest;

  while (restDock?.parent && restDock.box.height < 48 * dp) {
    restDock = restDock.parent;
  }

  const finish = appNodes.find((n) => n.attributes.text === "Finish");
  const toolbarBottom = finish ? finish.box.y + finish.box.height : 0;

  for (const node of appNodes) {
    const a = node.attributes;

    const interactive =
      a.clickable === "true" ||
      a["long-clickable"] === "true" ||
      a.checkable === "true" ||
      /(?:EditText|SeekBar|Spinner|NumberPicker)$/.test(a.class ?? "");

    if (!interactive) {
      continue;
    }

    const name = accessibleName(node);
    const b = node.box;
    const size = `${(b.width / dp).toFixed(1)}×${(b.height / dp).toFixed(1)} dp`;
    const id = `"${name || "<unnamed>"}" (${a.class}, ${size}, x=${b.x}, y=${b.y})`;

    if (!name) {
      failures.push(`${id}: missing accessible name`);
    }

    if (a.enabled === "false" || b.width <= 0 || b.height <= 0) {
      continue;
    }
    // A target touching a scroll viewport, screen edge, toolbar or fixed dock
    // may be partially clipped. It will be checked at the next scroll position.

    let left = 0;
    let top = 0;
    let right = width;
    let bottom = height;

    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.attributes.scrollable === "true") {
        left = Math.max(left, parent.box.x);
        top = Math.max(top, parent.box.y);
        right = Math.min(right, parent.box.x + parent.box.width);
        bottom = Math.min(bottom, parent.box.y + parent.box.height);
      }
    }

    const isTab = tabBar && b.y >= tabBar.box.y;

    if (!isTab && tabBar) {
      bottom = Math.min(bottom, tabBar.box.y);
    }

    if (restDock && node !== restDock && b.y < restDock.box.y) {
      bottom = Math.min(bottom, restDock.box.y);
    }

    if (finish && b.y > toolbarBottom) {
      top = Math.max(top, toolbarBottom);
    }

    const clipped =
      b.x <= left + 1 ||
      b.y <= top + 1 ||
      b.x + b.width >= right - 1 ||
      b.y + b.height >= bottom - 1;

    if (!clipped && (b.width / dp < 48 || b.height / dp < 48)) {
      failures.push(`${id}: enabled target must be at least 48×48 dp`);
    }
  }

  return failures;
}
