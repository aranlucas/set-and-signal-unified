import { test } from "@e2e-dev/mobile";
import { expect } from "e2e";
import { tap } from "./support";

test("system Back returns secondary tabs to Train", async ({ app, screen }) => {
  await app.clearState();
  await app.open();

  for (const tab of ["History", "Progress", "Settings"]) {
    await tap(screen, screen.getByText(tab));
    await app.back();
    await expect(screen.getByText("Fivefold")).toBeVisible();
    await expect(screen.getByText("Train")).toBeVisible();
  }
});
