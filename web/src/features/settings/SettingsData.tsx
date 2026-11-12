import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useStore, DEFAULT_STATE } from "@/app/store/useStore";
import { todayISO } from "@/shared/lib/format";
import { parseBackup } from "@/features/settings/backup";
import { buildExport } from "@/features/settings/export-csv";
import { EXIDX } from "@/domain/exercises/exercises";
import { IS_ANDROID } from "@/shared/lib/api";
import { REPO } from "@/shared/lib/demo";
import { MOBILE, shareExport } from "@/shared/lib/mobile";
import { importFromApp } from "@/features/settings/import-actions";
import { Row, Section } from "@/shared/components/layout";
import { Input } from "@/shared/ui/input";
import type { ConfirmDialogOptions } from "@/shared/components/ConfirmDialog";
import { toast } from "@/shared/lib/toast";
import type { SettingsSheet } from "@/features/settings/settings-types";

type SettingsDataProps = {
  user: { name: string } | null;
  requestConfirmation: (options: ConfirmDialogOptions) => void;
  onOpenSheet: (sheet: SettingsSheet) => void;
};

export function SettingsData({ user, requestConfirmation, onOpenSheet }: SettingsDataProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const appState = useStore((state) => state.appState);
  const replaceState = useStore((state) => state.replaceState);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    const json = JSON.stringify(appState, null, 2);
    const name = "set-and-signal-backup-" + todayISO() + ".json";

    if (MOBILE) {
      try {
        await shareExport(json, name);
        toast(t("settings.backupExported", "Backup exported"));
      } catch {
        /* share sheet dismissed */
      }

      return;
    }

    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t("settings.backupExported", "Backup exported"));
  };

  const doExportCsv = async () => {
    const { csv, filename } = buildExport(appState, (id) => EXIDX[id]?.n || id);

    if (MOBILE) {
      try {
        await shareExport(csv, filename);
        toast(t("settings.workoutsExported", "Workouts exported"));
      } catch {
        /* share sheet dismissed */
      }

      return;
    }

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t("settings.workoutsExported", "Workouts exported"));
  };

  const doImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    void file
      .text()
      .then((contents): undefined => {
        try {
          const restoredState = parseBackup(contents);
          requestConfirmation({
            title: t("settings.importBackupPrompt", "Import backup?"),
            description: t(
              "settings.replacesAllCurrentDataBackup",
              "This replaces all current data with the backup file.",
            ),
            confirmLabel: t("common.import", "Import"),
            danger: true,
            onConfirm: () => {
              replaceState(restoredState, true);
              toast(t("settings.backupImported", "Backup imported"));
            },
          });
        } catch (cause) {
          toast(
            t("settings.importFailed", "Import failed: {{error}}", {
              error: cause instanceof Error ? cause.message : String(cause),
            }),
          );
        }
      })
      .catch((cause: unknown) =>
        toast(
          t("settings.importFailed", "Import failed: {{error}}", {
            error: cause instanceof Error ? cause.message : String(cause),
          }),
        ),
      );
    event.target.value = "";
  };

  return (
    <>
      <Section title={t("settings.data", "Data")}>
        <Row
          icon="sparkles"
          iconTint="var(--primary)"
          title={t("plans.curated.title", "Curated plans")}
          accessory="chevron"
          onClick={() => onOpenSheet({ kind: "curated" })}
        />
        <Row
          icon="shuffle"
          iconTint="var(--system-teal)"
          title={t("import.importAnotherApp", "Import from another app")}
          subtitle={t(
            "import.fitNotesStrongHevyBody",
            "FitNotes, Strong, Hevy — or body weight from Apple Health",
          )}
          accessory="chevron"
          onClick={() => importRef.current?.click()}
        />
        <Row
          icon="upload"
          iconTint="var(--system-blue)"
          title={t("settings.importBackup", "Import backup")}
          accessory="chevron"
          onClick={() => fileRef.current?.click()}
        />
        <Row
          icon="download"
          iconTint="var(--system-blue)"
          title={t("settings.exportBackupJson", "Export backup (JSON)")}
          accessory="chevron"
          onClick={() => void doExport()}
        />
        <Row
          icon="download"
          iconTint="var(--system-teal)"
          title={t("settings.exportWorkoutsCsv", "Export workouts (CSV)")}
          subtitle={t(
            "settings.exportWorkoutsCsvDescription",
            "Opens in Excel, Sheets — or imports into Strong, Hevy & friends",
          )}
          accessory="chevron"
          onClick={() => void doExportCsv()}
        />
        <Row
          icon="trash"
          iconTint="var(--destructive)"
          title={t("settings.resetEverythingLabel", "Reset everything")}
          danger
          onClick={() =>
            requestConfirmation({
              title: t("settings.resetEverything", "Reset everything?"),
              description: t(
                "settings.deletesPlanWorkoutsBodyWeight",
                "Deletes your plan, workouts and body weight on this device. This cannot be undone.",
              ),
              confirmLabel: t("settings.deleteEverything", "Delete everything"),
              danger: true,
              onConfirm: () => {
                replaceState(structuredClone(DEFAULT_STATE), true);
                void navigate({ to: "/home" }).catch(console.error);
                toast(t("settings.allDataReset", "All data reset"));
              },
            })
          }
        />
      </Section>
      <Input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={doImport}
      />
      <Input
        ref={importRef}
        type="file"
        accept=".csv,.xml,text/csv,text/xml"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) {
            importFromApp(file, (parsed) => onOpenSheet({ kind: "import", parsed }));
          }

          event.target.value = "";
        }}
      />
      {!MOBILE && (
        <Section title={t("settings.tip", "Tip")}>
          <Row
            icon="lightbulb"
            iconTint="var(--warning)"
            title={
              IS_ANDROID
                ? t("settings.chromeMenuAddHomeScreen", "In Chrome: ⋮ menu → Add to Home screen")
                : t("settings.safariShareAddHomeScreen", "In Safari: Share → Add to Home Screen")
            }
            subtitle={
              t("settings.installAppFullScreen", "to install Set & Signal as a full-screen app.") +
              " " +
              (user
                ? t(
                    "settings.dataSyncsProfileSignAnywhere",
                    "Your data syncs with your profile — sign in anywhere to see it.",
                  )
                : t(
                    "settings.guestDataStaysDeviceExport",
                    "Guest data stays on this device — export a backup now and then!",
                  ))
            }
          />
        </Section>
      )}
      <div className="mt-1 text-center text-sm leading-relaxed text-muted-foreground">
        Set &amp; Signal · {t("settings.freeOpenSourceAgplV3", "free & open source (AGPL v3)")}
        <br />
        <a className="underline" href={REPO} target="_blank" rel="noreferrer">
          source code
        </a>{" "}
        · exercise data: hasaneyldrm/exercises-dataset (CC)
      </div>
    </>
  );
}
