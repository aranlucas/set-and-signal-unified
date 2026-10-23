import { expect, test } from "vitest";
import {
  accessibilityViolations,
  accessibleName,
  parseAccessibilityTree,
} from "./support/accessibility";
const node = (attrs = "", children = "") =>
  `<node package="app.fivefold.lifts" class="android.view.View" bounds="[10,10][110,110]" ${attrs}>${children}</node>`;
const tree = (body: string) =>
  parseAccessibilityTree(`<hierarchy>${body}</hierarchy>`);
const metrics = { width: 1080, height: 1920, dp: 2.625 };
test("generic clickable Compose row inherits descendant text and decoded labels", () => {
  const nodes = tree(
    node('clickable="true"', node('text="Weights &amp; equipment"')),
  );
  expect(accessibleName(nodes[0])).toBe("Weights & equipment");
  expect(accessibilityViolations(nodes, metrics)).toEqual([
    expect.stringContaining(
      '"Weights & equipment" (android.view.View, 38.1×38.1 dp',
    ),
  ]);
});
test("flags every unnamed interactive node, including disabled controls", () => {
  const nodes = tree(
    node('clickable="true" enabled="false"') + node('checkable="true"'),
  );
  expect(accessibilityViolations(nodes, metrics)).toHaveLength(3);
});
test("uses density for 48 dp and excludes targets touching a scroll clipping edge", () => {
  const nodes = tree(
    `<node package="app.fivefold.lifts" bounds="[10,10][500,500]" scrollable="true">${node('clickable="true" content-desc="Clipped"')}</node>`,
  );
  expect(accessibilityViolations(nodes, metrics)).toEqual([]);
  const large = tree(
    '<node package="app.fivefold.lifts" bounds="[20,20][146,146]" clickable="true" content-desc="Enough"/>',
  );
  expect(accessibilityViolations(large, metrics)).toEqual([]);
});
test("does not infer an accessible name from sibling text", () => {
  const nodes = tree(node('clickable="true"') + node('text="Sibling"'));
  expect(accessibilityViolations(nodes, metrics)[0]).toContain(
    "missing accessible name",
  );
});
