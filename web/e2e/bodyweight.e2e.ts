import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import * as v from "valibot";

const storedProfile = v.object({
  unit: v.picklist(["kg", "lb"]),
  bodyweight: v.array(v.object({ w: v.number() })),
});

// The shipped offline demo is a supported user journey. No mocked store or API:
// drive the form, reload the built app, then convert the saved record's units.
test("records body weight durably and converts it when units change", async ({
  app,
  browser,
  screen,
}) => {
  await app.open("/#/home/bodyweight");
  await screen.getByRole("button", { name: "plus 0.1 kg", exact: true }).click();
  await screen.getByRole("button", { name: "Save", exact: true }).click();
  await expect(screen.getByText("Weight saved", { exact: true })).toBeVisible();

  const before = v.parse(
    storedProfile,
    JSON.parse(await browser.evaluate(() => localStorage.getItem("gym_state_v1") ?? "{}")),
  );
  const saved = v.parse(v.number(), before.bodyweight.at(-1)?.w);

  expect(saved).toBeGreaterThan(0);
  await app.open("/#/home/bodyweight");
  await browser.reload();
  await expect(screen.getByText("Recent weigh-ins", { exact: true })).toBeVisible();
  await expect(
    browser.locator('[role="dialog"] b').filter({ hasText: `${saved} kg` }),
  ).toBeVisible();
  await app.open("/#/settings");
  await screen.getByRole("button", { name: "lb", exact: true }).click();
  await app.open("/#/settings");
  await browser.reload();
  await expect(screen.getByRole("button", { name: "lb", pressed: true })).toBeVisible();

  const converted = v.parse(
    storedProfile,
    JSON.parse(await browser.evaluate(() => localStorage.getItem("gym_state_v1") ?? "{}")),
  );
  const weight = v.parse(v.number(), converted.bodyweight.at(-1)?.w);

  expect(converted.unit).toBe("lb");
  expect(weight).toBeCloseTo(saved / 0.45359237, 0);
});
