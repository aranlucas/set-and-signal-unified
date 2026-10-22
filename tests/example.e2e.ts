import { test } from "@e2e-dev/mobile";
import { expect } from "e2e";

// The example `e2e init` writes, adapted to this app: it proves the installed
// target launches and exposes the four top-level destinations.
test("the installed app opens on its tabs", async ({ app, screen }) => {
  await app.open();

  await expect(screen.getByText("Train")).toBeVisible();
  await expect(screen.getByText("History")).toBeVisible();
  await expect(screen.getByText("Progress")).toBeVisible();
  await expect(screen.getByText("Settings")).toBeVisible();
});
