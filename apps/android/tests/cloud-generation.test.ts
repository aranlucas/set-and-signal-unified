import { afterEach, expect, it, vi } from "vitest";
import * as SecureStore from "expo-secure-store";
import { restoreCloudSession, signOut, synchronize } from "../src/data/cloud";
import { cloudDatabase, loadState } from "../src/data/storage";
import { pendingBatches, queueCloudChanges } from "../src/data/cloud-storage";

const convex = vi.hoisted(() => ({
  setAuth: vi.fn(),
  onUpdate: vi.fn(() => () => {}),
  close: vi.fn(async () => {}),
  mutation: vi.fn(async () => null),
}));

// No live WebSocket or reconnect timers in this controlled session-race fixture.
vi.mock("convex/browser", () => ({
  ConvexClient: class {
    setAuth = convex.setAuth;
    onUpdate = convex.onUpdate;
    close = convex.close;
    mutation = convex.mutation;
  },
}));

afterEach(async () => {
  await signOut();
  vi.restoreAllMocks();
});

it.each(["mutation", "finalization"])(
  "stops an old account after a delayed %s without acknowledging its outbox",
  async (boundary) => {
    loadState();
    const db = cloudDatabase();
    db.runSync("DELETE FROM cloud_queue");
    const gate = Promise.withResolvers<null>();
    const entered = Promise.withResolvers<void>();
    convex.mutation.mockImplementation(async () => {
      if (boundary === "mutation") {
        entered.resolve();
        await gate.promise;
      }
      return null;
    });
    const requests = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/api/convex/token")) {
        const owner = new Headers(init?.headers).get("Authorization")?.endsWith("alice")
          ? "alice"
          : "bob";
        return Response.json({
          token: "fixture",
          userId: owner,
          url: "https://fixture.convex.cloud",
        });
      }
      entered.resolve();
      await gate.promise;
      return Response.json({ ok: true });
    });
    const credentials = (id: string) =>
      JSON.stringify({
        base: "https://product.example",
        user: { id, name: id },
        clientId: "native",
        accessToken: id,
        issuedAt: Date.now() / 1000,
        expiresIn: 3600,
      });
    vi.spyOn(SecureStore, "getItemAsync").mockResolvedValue(credentials("alice"));
    await restoreCloudSession();
    queueCloudChanges(db, "alice", [
      { key: "workouts/one", expected: null, value: "{}" },
      { key: "workouts/two", expected: null, value: "{}" },
    ]);
    const original = pendingBatches(db, "alice");
    const syncing = synchronize();
    await entered.promise;
    await signOut();
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(credentials("bob"));
    await restoreCloudSession();
    const before = requests.mock.calls.length;
    gate.resolve(null);
    await syncing;
    expect(requests.mock.calls).toHaveLength(before);
    expect(pendingBatches(db, "alice")).toEqual(original);
    expect(pendingBatches(db, "bob")).toEqual([]);
  },
);
