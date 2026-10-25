import { afterAll, describe, test } from "@e2e-dev/mobile";
import { expect, type Screen } from "e2e";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { adb, tap } from "./support";
import { runSequentially } from "../support/sequential";
import { requireValue } from "../support/require-value";

const remote = "/sdcard/Documents";

const fixtureName = `fivefold-e2e-legacy-${Date.now()}.json`;

const created = new Set<string>();

let exportBaseline: Set<string> | undefined;

let local: string;

let firstExport: string;

function files() {
  return adb("shell", "ls", "-1", remote).trim().split(/\r?\n/).filter(Boolean);
}

// Always navigate to Documents, independent of Recent/last-used folder and of
// Android 15/17's capitalization. Storage roots themselves cannot be selected.
async function documents(screen: Screen) {
  await expect(
    screen.getByTestId("com.google.android.documentsui:id/action_bar_root"),
  ).toBeVisible();
  const breadcrumb = screen.getByTestId("com.google.android.documentsui:id/breadcrumb_text").last();

  if ((await breadcrumb.isVisible()) && (await breadcrumb.textContent()) === "Documents") {
    return;
  }

  const roots = screen.getByLabel(/show roots/i);

  if (await roots.isVisible()) {
    // The helper can include the adjacent toolbar title in this icon's x/width.
    // The leading square is anchored at the display edge in DocumentsUI.
    const box = await roots.boundingBox();

    if (!box) {
      throw new Error("DocumentsUI Show roots has no bounds");
    }

    await screen.tapAt({ x: box.height / 2, y: box.y + box.height / 2 });

    const storage = screen
      .getByText(/^(?:Internal storage|Internal shared storage|Pixel.*|sdk_gphone.*)$/i)
      .last();

    await expect(storage).toBeVisible();
    await tap(screen, storage);
    await expect(
      screen.getByTestId("com.google.android.documentsui:id/drawer_roots"),
    ).not.toBeVisible();
  } else {
    // The tree picker can hide roots and open directly at internal storage.
    await expect(breadcrumb).toHaveText(
      /^(?:Internal storage|Internal shared storage|Pixel.*|sdk_gphone.*)$/i,
    );
  }

  // The trailing match is the actual folder, after the toolbar filter chip.
  const documentsFolder = screen.getByText("Documents", { exact: true }).last();
  await screen.scrollUntilVisible(documentsFolder, { direction: "up" });
  await tap(screen, documentsFolder);
}

async function backupSheet(screen: Screen) {
  await tap(screen, screen.getByText("Settings").last());
  await tap(screen, screen.getByText("Backup & export"));
}

async function restore(screen: Screen, name: string) {
  await backupSheet(screen);
  await tap(screen, screen.getByText("Restore backup"));
  await documents(screen);
  await tap(screen, screen.getByText(name, { exact: true }));
  await tap(screen, screen.getByText("Replace & restore"), { stableFor: 500 });
  await expect(screen.getByText(/^Backup restored\./)).toBeVisible();
}

async function exportBackup(screen: Screen) {
  const before = new Set(files());
  exportBaseline = before;
  await backupSheet(screen);
  await tap(screen, screen.getByText("Export backup"));
  await documents(screen);
  await tap(screen, screen.getByRole("button", /^use this folder$/i));
  await tap(screen, screen.getByRole("button", /^allow$/i));
  await expect(screen.getByText(/^Backup saved(?:\.| in your selected folder\.)$/)).toBeVisible();
  let added: string[] = [];
  await expect
    .poll(() => {
      added = files().filter((file) => !before.has(file) && /^fivefold-.*\.json$/.test(file));

      return added.length;
    })
    .toBe(1);
  const name = added[0];
  created.add(name);
  const path = join(local, name);
  adb("pull", `${remote}/${name}`, path);

  return path;
}

async function assertRestored(screen: Screen, custom = false) {
  await tap(screen, screen.getByText("History"));
  await expect(screen.getByText("1 saved workout")).toBeVisible();
  await tap(screen, screen.getByText("Settings").last());
  await expect(screen.getByText("kg", { exact: true })).toBeVisible();
  await tap(screen, screen.getByText("Weights & equipment"));
  await screen.scrollUntilVisible(screen.getByText("Plates"));
  await expect(screen.getByText(custom ? "My plates · 6 sizes" : "Standard gym")).toBeVisible();
}

afterAll(() => {
  if (exportBaseline) {
    for (const name of files()) {
      if (!exportBaseline.has(name) && /^fivefold-.*\.json$/.test(name)) {
        created.add(name);
      }
    }
  }

  for (const name of created) {
    adb("shell", "rm", "-f", `${remote}/${name}`);
  }

  if (local) {
    rmSync(local, { recursive: true, force: true });
  }
});

describe("backup compatibility and round trip", { serial: true }, () => {
  test(
    "restores the byte-exact 1.2.1 backup through DocumentsUI",
    { timeout: 150_000 },
    async ({ app, screen }) => {
      local = mkdtempSync(join(tmpdir(), "fivefold-backup-"));
      adb("shell", "mkdir", "-p", remote);
      created.add(fixtureName);
      adb("push", resolve("tests/e2e/fixtures/backup-1.2.1.json"), `${remote}/${fixtureName}`);
      await app.clearState();
      await app.open();
      await restore(screen, fixtureName);
      await assertRestored(screen);
    },
  );

  test(
    "exports a custom inventory and restores it without changing the JSON",
    { timeout: 240_000 },
    async ({ app, screen }) => {
      await tap(screen, screen.getByText("Plates"));
      await tap(screen, screen.getByText("Count my plates"));
      const remove25 = screen.getByLabel("Remove a pair of 25 kg plates");
      await screen.scrollUntilVisible(remove25);
      await tap(screen, remove25);
      await expect(screen.getByText("3 pairs")).toBeVisible();
      const remove = screen.getByLabel("Remove a pair of 1.25 kg plates");
      await screen.scrollUntilVisible(remove);

      await runSequentially([0, 1, 2, 3], async () => {
        await tap(screen, remove);
      });

      await expect(screen.getByText("0 pairs")).toBeVisible();
      await screen.scrollUntilVisible(screen.getByText("Done"));
      await tap(screen, screen.getByText("Done"));
      firstExport = await exportBackup(screen);
      const name = requireValue(firstExport.split("/").at(-1), "Export must include a file name.");
      await app.clearState();
      await app.open();
      await restore(screen, name);
      await assertRestored(screen, true);
      // Assert actual restored pair counts, not just a non-default row caption.
      await tap(screen, screen.getByText("Plates"));
      await screen.scrollUntilVisible(screen.getByText("3 pairs"));
      await expect(screen.getByText("3 pairs")).toBeVisible();
      await screen.scrollUntilVisible(screen.getByText("0 pairs"));
      await expect(screen.getByText("0 pairs")).toBeVisible();
      await screen.scrollUntilVisible(screen.getByText("Done"));
      await tap(screen, screen.getByText("Done"));
      const secondExport = await exportBackup(screen);

      const first = readFileSync(firstExport, "utf8");
      const second = readFileSync(secondExport, "utf8");

      expect(JSON.parse(second), "Restore/export must preserve every JSON field").toEqual(
        JSON.parse(first),
      );
      expect(second, "Export/restore/export must also preserve the bytes").toBe(first);
    },
  );
});
