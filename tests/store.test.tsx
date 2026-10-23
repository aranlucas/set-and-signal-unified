import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "./support/native-renderer";
import { initialState, startSession } from "../src/domain/workout";
import { setNotes } from "../src/domain/commands";
import { requireValue } from "./support/require-value";
import {
  commit,
  configureStorage,
  getSnapshot,
  retry,
  subscribe,
  useAppState,
} from "../src/data/store";

const storage = { loadState: vi.fn(), saveState: vi.fn() };

beforeEach(() => {
  configureStorage(storage);
  storage.loadState.mockReset().mockReturnValue(initialState());
  storage.saveState.mockReset();
  retry();
});

afterEach(() => {
  cleanup();
});

it("saves before publishing, and notifies once for a successful commit", () => {
  const previous = getSnapshot();
  const listener = vi.fn(() => expect(getSnapshot().state.active).not.toBeNull());
  const unsubscribe = subscribe(listener);
  storage.saveState.mockImplementation(() => expect(getSnapshot()).toBe(previous));
  expect(commit((s) => startSession(s, 1000))).toBe(true);
  expect(storage.saveState).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenCalledOnce();
  expect(getSnapshot().error).toBe("");
  unsubscribe();
});

it("keeps the visible state after a failed save and publishes the storage error", () => {
  const previous = getSnapshot().state;
  storage.saveState.mockImplementation(() => {
    throw new Error("disk full");
  });
  const listener = vi.fn();
  const unsubscribe = subscribe(listener);
  expect(commit((s) => startSession(s, 1000))).toBe(false);
  expect(getSnapshot().state).toBe(previous);
  expect(getSnapshot().error).toBe("Couldn't save. Free up storage and try again.");
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
    throw new Error("invalid data");
  });

  // A fresh module tests the lazy initial read, rather than an already-ready retry.
  return importFreshStore();
});

async function importFreshStore() {
  vi.resetModules();
  const fresh = await import("../src/data/store");
  fresh.configureStorage(storage);
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

it("keeps reference and primitive selectors stable across unrelated note edits", () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  commit((s) => startSession(s, 1000));

  const exercises = requireValue(
    getSnapshot().state.active,
    "The workout should be active.",
  ).exercises;

  let renders = 0;
  let selected: unknown;

  function Reader() {
    renders++;
    selected = useAppState((s) => s.active?.exercises);
    useAppState((s) => s.settings.unit);

    return null;
  }

  render(<Reader />);
  const before = renders;
  act(() => {
    commit((s) => setNotes(s, "a"));
  });
  expect(selected).toBe(exercises);
  expect(renders).toBe(before);
});
