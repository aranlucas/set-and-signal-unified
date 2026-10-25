import { afterEach, expect, it, vi } from "vitest";
import * as SecureStore from "expo-secure-store";
import { restoreCloudSession, signOut, cloudSnapshot } from "../src/data/cloud";

afterEach(() => vi.restoreAllMocks());

it("cannot restore a signed-out account when its credential read completes late", async () => {
  const pending = Promise.withResolvers<string | null>();
  vi.spyOn(SecureStore, "getItemAsync").mockImplementation(() => pending.promise);
  const requests = vi.spyOn(globalThis, "fetch");
  const restoring = restoreCloudSession();
  await signOut();
  pending.resolve(
    JSON.stringify({
      base: "https://product.example",
      user: { id: "old-owner", name: "Old owner" },
      clientId: "native",
      accessToken: "fixture",
      issuedAt: Date.now() / 1000,
      expiresIn: 3600,
    }),
  );
  await restoring;
  expect(cloudSnapshot().user).toBeNull();
  expect(cloudSnapshot().phase).toBe("disconnected");
  expect(requests).not.toHaveBeenCalled();
});
