import * as validation from "valibot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../convex/schema";
import { api as convexApi } from "../../../convex/_generated/api";

import { ConvexClient } from "convex/browser";

const receiptMatcher: unknown = expect.any(String);

const fake = {
  mutation: vi.fn<ConvexClient["mutation"]>(),
  query: vi.fn<ConvexClient["query"]>(),
  close: vi.fn<ConvexClient["close"]>(),
};

// Keep the real client contract, but disable transport before installing instance spies.
const dependencies = {
  createClient(url: string) {
    const client = new ConvexClient(url, { disabled: true });
    vi.spyOn(client, "setAuth").mockImplementation(() => {});
    vi.spyOn(client, "subscribeToConnectionState").mockImplementation(() => () => {});
    vi.spyOn(client, "mutation").mockImplementation(fake.mutation);
    vi.spyOn(client, "query").mockImplementation(fake.query);
    vi.spyOn(client, "close").mockImplementation(fake.close);

    return client;
  },
  credentials: () => Promise.resolve({ token: "test", url: "https://test.convex.cloud" }),
};

import { TrainingSync, changesBetween } from "@/app/store/training-sync";

const saved = new Map<string, string>();

const modules = import.meta.glob("../../../convex/**/*.ts");

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  saved.clear();
  vi.resetAllMocks();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
    removeItem: (key: string) => {
      saved.delete(key);
    },
  });
  fake.mutation.mockResolvedValue(null);
  fake.query.mockResolvedValue({ unit: "kg" });
  fake.close.mockResolvedValue();
});

describe("durable Convex edits", () => {
  it.each(["QuotaExceededError", "SecurityError"])(
    "never uploads an edit rejected by storage with %s",
    async (name) => {
      const sync = new TrainingSync(
        "alice",
        vi.fn<() => void>(),
        vi.fn<() => void>(),
        undefined,
        dependencies,
      );

      const failure = new DOMException("Cannot persist pending edits", name);
      vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
        throw failure;
      });
      expect(() => sync.enqueue({ restSec: 90 }, { restSec: 120 })).toThrow(failure);
      await sync.start();
      await sync.flush();
      expect(fake.mutation).not.toHaveBeenCalled();
      expect(saved.has("gym_pending_convex:alice")).toBe(false);
      await sync.close();
    },
  );
  it.each([{ restSec: 120 }, {}])(
    "keeps the accepted baseline after a rejected update or deletion: %j",
    async (rejected) => {
      saved.set("gym_cache:alice", JSON.stringify({ restSec: 90 }));

      const sync = new TrainingSync(
        "alice",
        vi.fn<() => void>(),
        vi.fn<() => void>(),
        undefined,
        dependencies,
      );

      vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
        throw new Error("Storage unavailable");
      });
      expect(() => sync.enqueue({ restSec: 90 }, rejected)).toThrow("Storage unavailable");
      sync.enqueue({ restSec: 90 }, { restSec: 150 });
      await sync.start();
      expect(fake.mutation).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
        operationId: receiptMatcher,
        changes: [{ key: "field/restSec", expected: "90", value: "150" }],
      });
      await sync.close();
    },
  );
  it("preserves earlier admitted edits when a later admission fails", async () => {
    saved.set("gym_cache:alice", JSON.stringify({ restSec: 90 }));

    const sync = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    sync.enqueue({ restSec: 90 }, { restSec: 120 });
    const pending = saved.get("gym_pending_convex:alice");
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("Storage unavailable");
    });
    expect(() => sync.enqueue({ restSec: 120 }, { restSec: 150 })).toThrow("Storage unavailable");
    expect(saved.get("gym_pending_convex:alice")).toBe(pending);
    sync.enqueue({ restSec: 120 }, { restSec: 180 });
    await sync.start();
    expect(fake.mutation).toHaveBeenCalledTimes(2);
    expect(fake.mutation).toHaveBeenNthCalledWith(1, expect.anything(), {
      operationId: receiptMatcher,
      changes: [{ key: "field/restSec", expected: "90", value: "120" }],
    });
    expect(fake.mutation).toHaveBeenNthCalledWith(2, expect.anything(), {
      operationId: receiptMatcher,
      changes: [{ key: "field/restSec", expected: "120", value: "180" }],
    });
    await sync.close();
  });
  it("retains an acknowledged batch until its removal is durable", async () => {
    const pending = JSON.stringify([
      [{ operationId: "persisted-operation", key: "field/unit", expected: '"lb"', value: '"kg"' }],
    ]);

    saved.set("gym_pending_convex:alice", pending);
    const status = vi.fn<() => void>();

    const sync = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      status,
      dependencies,
    );

    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("Storage unavailable");
    });
    await expect(sync.start()).rejects.toThrow("Storage unavailable");
    expect(saved.get("gym_pending_convex:alice")).toBe(pending);
    expect(status).toHaveBeenLastCalledWith({ phase: "error", pending: 1 });
    await sync.flush();
    expect(fake.mutation).toHaveBeenCalledTimes(2);
    expect(fake.mutation).toHaveBeenLastCalledWith(expect.anything(), {
      operationId: receiptMatcher,
      changes: [{ key: "field/unit", expected: '"lb"', value: '"kg"' }],
    });
    expect(saved.get("gym_pending_convex:alice")).toBe("[]");
    expect(status).toHaveBeenLastCalledWith({ phase: "saved", pending: 0 });
    await sync.close();
  });
  it("retains edits admitted while a previous batch is in flight", async () => {
    fake.query.mockResolvedValue({ restSec: 90 });

    const sync = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    await sync.start();
    const acknowledge = vi.fn<(value: null) => void>();

    const first = new Promise<null>((resolve) => {
      acknowledge.mockImplementation(resolve);
    });

    fake.mutation.mockReturnValueOnce(first);
    sync.enqueue({ restSec: 90 }, { restSec: 120 });
    sync.enqueue({ restSec: 120 }, { restSec: 150 });
    const pending = saved.get("gym_pending_convex:alice");
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("Storage unavailable");
    });
    const failedFlush = sync.flush();
    acknowledge(null);
    await expect(failedFlush).rejects.toThrow("Storage unavailable");
    expect(saved.get("gym_pending_convex:alice")).toBe(pending);
    expect(fake.mutation).toHaveBeenCalledTimes(1);
    await sync.flush();
    expect(fake.mutation).toHaveBeenCalledTimes(3);
    expect(fake.mutation).toHaveBeenNthCalledWith(2, expect.anything(), {
      operationId: receiptMatcher,
      changes: [{ key: "field/restSec", expected: "90", value: "120" }],
    });
    expect(fake.mutation).toHaveBeenNthCalledWith(3, expect.anything(), {
      operationId: receiptMatcher,
      changes: [{ key: "field/restSec", expected: "120", value: "150" }],
    });
    expect(saved.get("gym_pending_convex:alice")).toBe("[]");
    await sync.close();
  });
  it("replays after an acknowledgment storage failure without duplicate server effects", async () => {
    const server = convexTest(schema, modules).withIdentity({ subject: "alice", service: true });
    await server.mutation(convexApi.training.replace, {
      state: JSON.stringify({ restSec: 90 }),
      expected: null,
    });
    const snapshots: unknown[] = [];
    fake.query.mockImplementation(() => server.query(convexApi.training.snapshot, {}));
    fake.mutation.mockImplementation(async (_reference, args) => {
      const parsedArgs = validation.parse(
        validation.object({
          operationId: validation.optional(validation.string()),
          changes: validation.array(
            validation.object({
              key: validation.string(),
              expected: validation.nullable(validation.string()),
              value: validation.nullable(validation.string()),
            }),
          ),
        }),
        args,
      );

      await server.mutation(convexApi.training.commit, parsedArgs);
      snapshots.push(await server.query(convexApi.training.snapshot, {}));

      return null;
    });
    saved.set("gym_cache:alice", JSON.stringify({ restSec: 90 }));

    const sync = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    sync.enqueue({ restSec: 90 }, { restSec: 120 });
    sync.enqueue({ restSec: 120 }, { restSec: 150 });
    vi.spyOn(localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("Storage unavailable");
    });
    await expect(sync.start()).rejects.toThrow("Storage unavailable");
    await sync.close();

    const reopened = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    await reopened.start();
    expect(fake.mutation).toHaveBeenCalledTimes(3);
    expect(snapshots[0]).toMatchObject({ restSec: 120 });
    expect(snapshots[1]).toEqual(snapshots[0]);
    expect(snapshots[2]).toMatchObject({ restSec: 150 });
    expect(saved.get("gym_pending_convex:alice")).toBe("[]");
    await reopened.close();
  });
  it("keeps pending edits scoped to their original account after closing", async () => {
    const alice = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    alice.enqueue({ restSec: 90 }, { restSec: 120 });
    await alice.close();

    const bob = new TrainingSync(
      "bob",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    bob.enqueue({ restSec: 90 }, { restSec: 180 });
    await bob.close();
    const bobPending = saved.get("gym_pending_convex:bob");

    const reopened = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    await reopened.start();
    expect(fake.mutation).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      operationId: receiptMatcher,
      changes: [{ key: "field/restSec", expected: null, value: "120" }],
    });
    expect(saved.get("gym_pending_convex:bob")).toBe(bobPending);
    expect(saved.get("gym_pending_convex:alice")).toBe("[]");
    await reopened.close();
  });
  it("migrates a legacy queue before sending and keeps its receipt across reopening", async () => {
    saved.set(
      "gym_pending_convex:alice",
      JSON.stringify([[{ key: "field/restSec", expected: null, value: "120" }]]),
    );
    fake.mutation.mockRejectedValue(new Error("offline"));

    const first = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    await expect(first.start()).rejects.toThrow("offline");
    const original: unknown = fake.mutation.mock.calls[0]?.[1];
    expect(original).toMatchObject({ operationId: receiptMatcher });
    await first.close();

    const next = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    await expect(next.start()).rejects.toThrow("offline");
    expect(fake.mutation.mock.lastCall?.[1]).toEqual(original);
    await next.close();
  });

  it("keeps stale-unit numerical edits for recovery instead of applying a label-only resolution", async () => {
    saved.set("gym_cache:alice", JSON.stringify({ unit: "lb" }));
    saved.set(
      "gym_pending_convex:alice",
      JSON.stringify([
        [{ key: "field/unit", expected: '"lb"', value: '"lb"', operationId: "guarded-session" }],
      ]),
    );
    fake.query.mockResolvedValue({ unit: "kg" });
    fake.mutation.mockRejectedValue(new Error("CONFLICT"));

    const sync = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    await expect(sync.start()).rejects.toThrow("CONFLICT");
    const pending = saved.get("gym_pending_convex:alice");
    await expect(sync.resolve(await sync.conflicts(), "remote")).rejects.toThrow(
      "Weight units changed",
    );
    expect(saved.get("gym_pending_convex:alice")).toBe(pending);
    await sync.close();
  });

  it("never sends active workouts or client timestamps", () => {
    expect(changesBetween({ _ts: 1, active: null }, { _ts: 2, active: null })).toEqual([]);
  });
  it("replays persisted edits after reopening and clears only acknowledged batches", async () => {
    saved.set(
      "gym_pending_convex:alice",
      JSON.stringify([
        [
          {
            operationId: "persisted-operation",
            key: "field/unit",
            expected: '"lb"',
            value: '"kg"',
          },
        ],
      ]),
    );
    const receive = vi.fn<() => void>();
    const sync = new TrainingSync("alice", receive, vi.fn<() => void>(), undefined, dependencies);
    await sync.start();
    expect(fake.mutation).toHaveBeenCalledTimes(1);
    expect(saved.get("gym_pending_convex:alice")).toBe("[]");
    expect(receive).toHaveBeenCalledWith({ unit: "kg" });
    await sync.close();
  });
  it("creates a missing field without treating UI defaults as stored server values", async () => {
    fake.query.mockResolvedValue(null);

    const sync = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    await sync.start();
    sync.enqueue({ restSec: 90 }, { restSec: 120 });
    await sync.flush();
    expect(fake.mutation).toHaveBeenCalledWith(expect.anything(), {
      operationId: receiptMatcher,
      changes: [{ key: "field/restSec", expected: null, value: "120" }],
    });
    await sync.close();
  });
  it("uses the cached server baseline for edits queued before reconnecting", async () => {
    saved.set("gym_cache:alice", JSON.stringify({ restSec: 90 }));

    const sync = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    sync.enqueue({ restSec: 90 }, { restSec: 120 });
    await sync.start();
    expect(fake.mutation).toHaveBeenCalledWith(expect.anything(), {
      operationId: receiptMatcher,
      changes: [{ key: "field/restSec", expected: "90", value: "120" }],
    });
    await sync.close();
  });
  it("retains conflicting edits and offers recovery without overwriting them", async () => {
    const pending = JSON.stringify([
      [{ operationId: "persisted-operation", key: "field/unit", expected: '"lb"', value: '"kg"' }],
    ]);

    saved.set("gym_pending_convex:alice", pending);
    fake.mutation.mockRejectedValue(new Error("CONFLICT"));
    const receive = vi.fn<() => void>();
    const sync = new TrainingSync("alice", receive, vi.fn<() => void>(), undefined, dependencies);
    await expect(sync.start()).rejects.toThrow("CONFLICT");
    expect(saved.get("gym_pending_convex:alice")).toBe(pending);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ unit: "kg" }));
    await sync.close();
  });
});

describe("reviewing competing edits", () => {
  it("keeps the original queue when saving a conflict resolution fails", async () => {
    const pending = JSON.stringify([
      [{ operationId: "persisted-operation", key: "field/restSec", expected: "90", value: "120" }],
    ]);

    saved.set("gym_pending_convex:alice", pending);
    fake.query.mockResolvedValue({ restSec: 100 });
    fake.mutation.mockRejectedValue(new Error("CONFLICT"));

    const sync = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    await expect(sync.start()).rejects.toThrow("CONFLICT");
    const conflicts = await sync.conflicts();
    const originalSetItem = localStorage.setItem.bind(localStorage);
    vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === "gym_pending_convex:alice") {
        throw new Error("Storage unavailable");
      }

      originalSetItem(key, value);
    });
    await expect(sync.resolve(conflicts, "remote")).rejects.toThrow("Storage unavailable");
    expect(saved.get("gym_pending_convex:alice")).toBe(pending);
    expect(await sync.conflicts()).toEqual(conflicts);
    await expect(sync.flush()).rejects.toThrow("CONFLICT");
    expect(fake.mutation).toHaveBeenCalledTimes(2);
    await sync.close();
  });
  it("keeps unrelated edits when accepting another version", async () => {
    saved.set("gym_cache:alice", JSON.stringify({ unit: "kg", restSec: 90 }));
    saved.set(
      "gym_pending_convex:alice",
      JSON.stringify([
        [
          { key: "field/unit", expected: '"kg"', value: '"lb"' },
          { key: "field/restSec", expected: "90", value: "120" },
        ],
      ]),
    );
    fake.query.mockResolvedValue({ unit: "kg", restSec: 90 });
    fake.mutation.mockRejectedValueOnce(new Error("CONFLICT"));
    const status = vi.fn<() => void>();

    const sync = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      status,
      dependencies,
    );

    await expect(sync.start()).rejects.toThrow("CONFLICT");
    await sync.resolve([{ key: "field/unit", local: '"lb"', remote: '"kg"' }], "remote");
    expect(fake.mutation).toHaveBeenLastCalledWith(expect.anything(), {
      operationId: receiptMatcher,
      changes: [{ key: "field/restSec", expected: "90", value: "120" }],
    });
    expect(status).toHaveBeenLastCalledWith({ phase: "saved", pending: 0 });
    expect([...saved.keys()].some((key) => key.includes(":recovery:"))).toBe(true);
    await sync.close();
  });
  it("checks the reviewed version when keeping local edits", async () => {
    saved.set(
      "gym_pending_convex:alice",
      JSON.stringify([
        [
          {
            operationId: "persisted-operation",
            key: "field/restSec",
            expected: "90",
            value: "120",
          },
        ],
      ]),
    );
    fake.query.mockResolvedValue({ restSec: 100 });
    fake.mutation.mockRejectedValueOnce(new Error("CONFLICT"));

    const sync = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    await expect(sync.start()).rejects.toThrow("CONFLICT");
    const conflicts = await sync.conflicts();
    expect(conflicts).toEqual([{ key: "field/restSec", local: "120", remote: "100" }]);
    await sync.resolve(conflicts, "local");
    expect(fake.mutation).toHaveBeenLastCalledWith(expect.anything(), {
      operationId: receiptMatcher,
      changes: [{ key: "field/restSec", expected: "100", value: "120" }],
    });
    await sync.close();
  });
  it("does not report an offline pending queue as flushed", async () => {
    const sync = new TrainingSync(
      "alice",
      vi.fn<() => void>(),
      vi.fn<() => void>(),
      undefined,
      dependencies,
    );

    sync.enqueue({ restSec: 90 }, { restSec: 120 });
    await expect(sync.flush()).rejects.toThrow("Connect to save");
    expect(saved.get("gym_pending_convex:alice")).toContain("120");
    await sync.close();
  });
});
