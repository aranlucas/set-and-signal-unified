import * as validation from "valibot";
import { jsonValue } from "@/shared/lib/schemas";
import { describe, expect, it } from "vitest";
import { canonical, joinState, splitState } from "@set-and-signal/training/state";

describe("forward-compatible persistence boundary", () => {
  it("preserves unknown nested fields, record metadata and prototype-named keys", () => {
    const state = {
      futureFeature: { enabled: true, version: 3, values: [null, "x", 2] },
      workouts: [{ id: "future-1", futureMetadata: { unit: "custom", flags: [1, 2] } }],
      ["__proto__"]: { marker: "data-only" },
      active: { localOnly: true },
      _ts: 1,
    };

    const restored = joinState(splitState(state), 2);
    expect(restored).toEqual({
      futureFeature: state.futureFeature,
      workouts: state.workouts,
      ["__proto__"]: { marker: "data-only" },
      _ts: 2,
    });
    expect(Object.getPrototypeOf(restored)).toBe(Object.prototype);
  });

  it("keeps canonical conflict encodings stable and omission distinct from null", () => {
    expect(canonical({ z: 2, a: { y: 1, b: [3, null, 1] } })).toBe(
      '{"a":{"b":[3,null,1],"y":1},"z":2}',
    );
    expect(canonical({ optional: undefined })).toBe("{}");
    expect(canonical({ optional: null })).toBe('{"optional":null}');
    expect(splitState({ routines: [{ id: "b" }, { id: "a" }] }).at(-1)).toEqual({
      key: "order/routines",
      value: '["b","a"]',
    });
    expect(() => splitState({ workouts: [{ id: "a" }, { id: "a" }] })).toThrow("duplicate");
    expect(() => splitState({ workouts: [{ id: 5 }] })).toThrow("Invalid");
  });
});

it("validates transport JSON without stripping forward-compatible property names", () => {
  const payload: unknown = JSON.parse(
    '{"__proto__":{"marker":true},"constructor":1,"prototype":"field","future":{"x":2}}',
  );

  const parsed = validation.parse(jsonValue, payload);
  expect(parsed).toBe(payload);
  expect(Object.keys(parsed ?? {})).toEqual(["__proto__", "constructor", "prototype", "future"]);
  expect(validation.safeParse(jsonValue, { future: () => 1 }).success).toBe(false);
});
