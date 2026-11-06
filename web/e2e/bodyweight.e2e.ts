import { test } from "@e2e-dev/web";
import { expect } from "e2e";

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
  const saved = await browser.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("gym_state_v1") ?? "{}");
    return state.bodyweight.at(-1).w as number;
  });
  expect(saved).toBeGreaterThan(0);
  await app.open("/#/home/bodyweight");
  await browser.reload();
  await expect(screen.getByText("Recent weigh-ins", { exact: true })).toBeVisible();
  await expect(screen.getByText(`${saved} kg`, { exact: true })).toBeVisible();
  await app.open("/#/settings");
  await screen.getByRole("button", { name: "lb", exact: true }).click();
  await app.open("/#/settings");
  await browser.reload();
  await expect(screen.getByRole("button", { name: "lb", pressed: true })).toBeVisible();
  const converted = await browser.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("gym_state_v1") ?? "{}");
    return { unit: state.unit as string, weight: state.bodyweight.at(-1).w as number };
  });
  expect(converted.unit).toBe("lb");
  expect(converted.weight).toBeCloseTo(saved / 0.45359237, 0);
});
