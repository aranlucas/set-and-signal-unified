import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../../../convex/schema";
import { api } from "../../../convex/_generated/api";
import { splitState, joinState } from "@set-and-signal/training/state";

const modules = import.meta.glob("../../../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);

  return {
    t,
    alice: t.withIdentity({ subject: "alice", service: true }),
    bob: t.withIdentity({ subject: "bob", service: true }),
    browser: t.withIdentity({ subject: "alice" }),
  };
}

describe("Convex training authority", () => {
  it("isolates users and rejects anonymous and browser snapshot replacements", async () => {
    const { t, alice, bob, browser } = setup();
    await expect(t.query(api.training.snapshot, {})).rejects.toThrow("Unauthorized");
    await alice.mutation(api.training.replace, { state: '{"workouts":[]}', expected: null });
    expect(await bob.query(api.training.snapshot, {})).toBeNull();
    await expect(
      browser.mutation(api.training.replace, { state: "{}", expected: null }),
    ).rejects.toThrow("Unauthorized");
  });
  it("checks revisions and strips active drafts", async () => {
    const { alice } = setup();
    await alice.mutation(api.training.replace, {
      state: '{"unit":"lb","active":{"id":"local"}}',
      expected: null,
    });
    expect(await alice.query(api.training.snapshot, {})).toMatchObject({ unit: "lb" });
    expect(await alice.query(api.training.snapshot, {})).not.toHaveProperty("active");
  });
  it("merges independent edits, retries safely and rejects stale edits atomically", async () => {
    const { alice, browser } = setup();
    await alice.mutation(api.training.replace, {
      state: '{"unit":"lb","restSec":60}',
      expected: null,
    });
    const unit = { key: "field/unit", expected: '"lb"', value: '"kg"' };
    await browser.mutation(api.training.commit, { changes: [unit] });
    await browser.mutation(api.training.commit, { changes: [unit] });
    await browser.mutation(api.training.commit, {
      changes: [{ key: "field/restSec", expected: "60", value: "90" }],
    });
    await expect(
      browser.mutation(api.training.commit, {
        changes: [
          { key: "field/sound", expected: null, value: "true" },
          { ...unit, value: '"stale"' },
        ],
      }),
    ).rejects.toThrow(/CONFLICT/u);
    const value = await alice.query(api.training.snapshot, {});
    expect(value).toMatchObject({ unit: "kg", restSec: 90 });
    expect(value).not.toHaveProperty("sound");
  });
  it("remembers owner-scoped operation receipts after a later deletion", async () => {
    const { alice, bob, browser } = setup();

    const value = JSON.stringify({
      d: "2026-10-25",
      end: 2,
      entries: [],
      id: "native-1",
      name: "A",
      prs: [],
      start: 1,
      vol: 0,
    });

    const changes = [
      { key: "workouts/native-1", expected: null, value },
      { key: "order/workouts", expected: null, value: '["native-1"]' },
    ];

    await browser.mutation(api.training.commit, { operationId: "device/alice/1", changes });
    await browser.mutation(api.training.commit, {
      operationId: "delete-1",
      changes: [
        { key: "workouts/native-1", expected: value, value: null },
        { key: "order/workouts", expected: '["native-1"]', value: "[]" },
      ],
    });
    await browser.mutation(api.training.commit, { operationId: "device/alice/1", changes });
    expect(await alice.query(api.training.snapshot, {})).toMatchObject({ workouts: [] });
    await bob.mutation(api.training.commit, { operationId: "device/alice/1", changes });
    expect(await bob.query(api.training.snapshot, {})).toMatchObject({
      workouts: [{ id: "native-1" }],
    });
  });

  it("rejects an offline workout expressed in an earlier profile unit", async () => {
    const { alice, browser } = setup();
    await alice.mutation(api.training.replace, {
      state: '{"unit":"kg","workouts":[]}',
      expected: null,
    });
    await expect(
      browser.mutation(api.training.commit, {
        operationId: "offline-pound-session",
        changes: [
          { key: "field/unit", expected: '"lb"', value: '"lb"' },
          { key: "field/restSec", expected: null, value: "60" },
        ],
      }),
    ).rejects.toThrow(/CONFLICT/u);
    expect(await alice.query(api.training.snapshot, {})).not.toHaveProperty("restSec");
  });

  it("round trips record order and rejects duplicate record identities", () => {
    const state = {
      workouts: [
        { id: "b", d: "2026-09-02" },
        { id: "a", d: "2026-09-01" },
      ],
      unit: "lb",
    };

    expect(joinState(splitState(state), 42)).toEqual({ ...state, _ts: 42 });
    expect(() => splitState({ workouts: [{ id: "a" }, { id: "a" }] })).toThrow("duplicate");
  });
});
