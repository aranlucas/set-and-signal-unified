import { Column, Text } from "@expo/ui/jetpack-compose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, type Root } from "./support/native-renderer";

let renderer: Root | undefined;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup();
  renderer = undefined;
  vi.restoreAllMocks();
});

it("accepts primitive children, ignored values, arrays and nested Text spans", () => {
  renderer = render(
    <Text>
      {["Ready", 2, false, true, null, undefined, [" "]]}
      <Text>
        set <Text>{3}</Text>
      </Text>
    </Text>,
  );
  const textNode = renderer.container.queryAll((node) => node.type === "Text")[0];
  expect(textNode.toJSON()).toMatchObject({
    type: "Text",
    props: {},
    children: [
      "Ready",
      "2",
      " ",
      {
        type: "Text",
        props: {},
        children: ["set ", { type: "Text", props: {}, children: ["3"] }],
      },
    ],
  });
});

function CustomCaption() {
  return <Text>Unsupported wrapper</Text>;
}

it.each([
  { label: "a Fragment", child: <>Hidden caption</>, type: "Fragment" },
  { label: "another native control", child: <Column />, type: "Column" },
  {
    label: "a custom component",
    child: <CustomCaption />,
    type: "CustomCaption",
  },
  {
    label: "a Fragment inside nested arrays",
    child: ["Allowed", [false, <>Hidden caption</>]],
    type: "Fragment",
  },
  {
    label: "an unsupported descendant of nested Text",
    child: <Text>{["Allowed", <CustomCaption key="caption" />]}</Text>,
    type: "CustomCaption",
  },
])("rejects $label and names its type", ({ child, type }) => {
  expect(() => render(<Text>{child}</Text>)).toThrow(
    `Unsupported child element of type "${type}" inside <Text>`,
  );
});
