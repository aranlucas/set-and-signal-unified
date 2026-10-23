import "./support/native";
import { Column, Text } from "@expo/ui/jetpack-compose";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.restoreAllMocks();
});

it("accepts primitive children, ignored values, arrays and nested Text spans", async () => {
  await act(async () => {
    renderer = create(
      <Text>
        {["Ready", 2, false, true, null, undefined, [" "]]}
        <Text>
          set <Text>{3}</Text>
        </Text>
      </Text>,
    );
  });
  expect(renderer!.toJSON()).toEqual({
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
])("rejects $label and names its type", async ({ child, type }) => {
  await expect(
    act(async () => {
      renderer = create(<Text>{child}</Text>);
    }),
  ).rejects.toThrow(
    `Unsupported child element of type "${type}" inside <Text>`,
  );
});
