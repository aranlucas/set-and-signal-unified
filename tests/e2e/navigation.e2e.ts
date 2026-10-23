import { test } from "@e2e-dev/mobile";
import { expect } from "e2e";
import { tap } from "./support";
import { runSequentially } from "../support/sequential";

test("system Back returns secondary tabs to Train", async ({ app, screen }) => {
  await app.clearState();
  await app.open();

  await runSequentially(["History", "Progress", "Settings"], async (tab) => {
    await tap(screen, screen.getByText(tab));
    await app.back();
    await expect(screen.getByText("Fivefold")).toBeVisible();
    await expect(screen.getByText("Train")).toBeVisible();
  });
});
