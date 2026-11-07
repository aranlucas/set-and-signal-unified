import { afterEach, expect, it, vi } from "vitest";
import { ConvexClient } from "convex/browser";
import * as SecureStore from "expo-secure-store";
import { restoreCloudSession, signOut, synchronize } from "../src/data/cloud";
import { cloudDatabase, loadState } from "../src/data/storage";
import { pendingBatches, queueCloudChanges } from "../src/data/cloud-storage";

function credentials(id: string) {
  return JSON.stringify({
    base: "https://product.example",
    user: { id, name: id },
    clientId: "native",
    accessToken: id,
    issuedAt: Date.now() / 1000,
    expiresIn: 3600,
  });
}

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
    vi.spyOn(ConvexClient.prototype, "mutation").mockImplementation(async () => {
      if (boundary === "mutation") {
        entered.resolve();
        await gate.promise;
      }

      return null;
    });

    const requests = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if ((input instanceof Request ? input.url : input.toString()).endsWith("/api/convex/token")) {
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

    vi.spyOn(SecureStore, "getItemAsync").mockResolvedValue(credentials("alice"));
    await restoreCloudSession({ disabled: true });
    queueCloudChanges(db, "alice", [
      { key: "workouts/one", expected: null, value: "{}" },
      { key: "workouts/two", expected: null, value: "{}" },
    ]);
    const original = pendingBatches(db, "alice");
    const syncing = synchronize();
    await entered.promise;
    await signOut();
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue(credentials("bob"));
    await restoreCloudSession({ disabled: true });

    const before = requests.mock.calls.length;
    gate.resolve(null);
    await syncing;
    expect(requests.mock.calls).toHaveLength(before);
    expect(pendingBatches(db, "alice")).toEqual(original);
    expect(pendingBatches(db, "bob")).toEqual([]);
  },
);
