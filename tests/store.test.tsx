import { act } from "react";
import { create } from "react-test-renderer";
import { beforeEach, expect, it, vi } from "vitest";
import { initialState, startSession } from "../src/domain/workout";
import { setNotes } from "../src/domain/commands";

const storage = vi.hoisted(() => ({ loadState: vi.fn(), saveState: vi.fn() }));
vi.mock("../src/data/storage", () => storage);
import {
  commit,
  getSnapshot,
  retry,
  subscribe,
  useAppState,
} from "../src/data/store";

beforeEach(() => {
  storage.loadState.mockReset().mockReturnValue(initialState());
  storage.saveState.mockReset();
  retry();
});
it("saves before publishing, and notifies once for a successful commit", () => {
  const previous = getSnapshot();
  const listener = vi.fn(() =>
    expect(getSnapshot().state.active).not.toBeNull(),
  );
  const unsubscribe = subscribe(listener);
  storage.saveState.mockImplementation(() =>
    expect(getSnapshot()).toBe(previous),
  );
  expect(commit((s) => startSession(s, 1000))).toBe(true);
  expect(storage.saveState).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenCalledOnce();
  expect(getSnapshot().error).toBe("");
  unsubscribe();
});
it("keeps the visible state after a failed save and publishes the storage error", () => {
  const previous = getSnapshot().state;
  storage.saveState.mockImplementation(() => {
    throw Error("disk full");
  });
  const listener = vi.fn();
  const unsubscribe = subscribe(listener);
  expect(commit((s) => startSession(s, 1000))).toBe(false);
  expect(getSnapshot().state).toBe(previous);
  expect(getSnapshot().error).toBe(
    "Couldn't save. Free up storage and try again.",
  );
  expect(listener).toHaveBeenCalledOnce();
  storage.saveState.mockReset();
  expect(commit((s) => startSession(s, 1000))).toBe(true);
  expect(getSnapshot().error).toBe("");
  unsubscribe();
});
it("does not save or notify for identity no-ops", () => {
  const previous = getSnapshot();
  const listener = vi.fn();
  const unsubscribe = subscribe(listener);
  expect(commit((s) => s)).toBe(true);
  expect(getSnapshot()).toBe(previous);
  expect(storage.saveState).not.toHaveBeenCalled();
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});
it("retries failed reads without saving defaults or allowing commits", () => {
  storage.loadState.mockImplementation(() => {
    throw Error("invalid data");
  });
  // A fresh module tests the lazy initial read, rather than an already-ready retry.
  return importFreshStore();
});
async function importFreshStore() {
  vi.resetModules();
  const fresh = await import("../src/data/store");
  storage.loadState.mockClear();
  expect(storage.loadState).not.toHaveBeenCalled();
  expect(fresh.getSnapshot()).toMatchObject({
    ready: false,
    error: "invalid data",
  });
  const previous = fresh.getSnapshot().state;
  expect(fresh.commit((s) => startSession(s, 1000))).toBe(false);
  expect(storage.saveState).not.toHaveBeenCalled();
  const listener = vi.fn();
  const unsubscribe = fresh.subscribe(listener);
  fresh.retry();
  expect(fresh.getSnapshot().state).toBe(previous);
  expect(listener).toHaveBeenCalledOnce();
  storage.loadState.mockReturnValue(initialState("kg"));
  fresh.retry();
  expect(fresh.getSnapshot()).toMatchObject({
    ready: true,
    error: "",
    state: { settings: { unit: "kg" } },
  });
  expect(storage.saveState).not.toHaveBeenCalled();
  unsubscribe();
}
it("keeps reference and primitive selectors stable across unrelated note edits", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  commit((s) => startSession(s, 1000));
  const exercises = getSnapshot().state.active!.exercises;
  let renders = 0;
  let selected: unknown;
  function Reader() {
    renders++;
    selected = useAppState((s) => s.active?.exercises);
    const unit = useAppState((s) => s.settings.unit);
    return <>{unit}</>;
  }
  let root: ReturnType<typeof create>;
  await act(async () => {
    root = create(<Reader />);
  });
  const before = renders;
  await act(async () => {
    commit((s) => setNotes(s, "a"));
  });
  expect(selected).toBe(exercises);
  expect(renders).toBe(before);
  await act(async () => root.unmount());
});
