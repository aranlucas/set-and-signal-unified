import { GarminPanel } from "@/features/garmin/GarminPanel";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@/app/store/useStore";
import { webauthnOK, passkeyLogin } from "@/shared/lib/api";
import { DEMO, REPO } from "@/shared/lib/demo";
import { MOBILE } from "@/shared/lib/mobile";
import { CuratedPlans } from "@/features/plan/CuratedPlanSheet";
import { ImportSummary } from "@/features/settings/ImportSheet";
import { EffortHelpDialog } from "@/features/settings/EffortHelpDialog";
import { SettingsData } from "@/features/settings/SettingsData";
import { SettingsPreferences } from "@/features/settings/SettingsPreferences";
import { UserRows } from "@/features/settings/UserRows";
import type { SettingsSheet } from "@/features/settings/settings-types";
import Icon from "@/shared/components/Icon";
import { PageHeader, PageTitle, Row, Section } from "@/shared/components/layout";
import { Button } from "@/shared/ui/button";
import ConfirmDialog from "@/shared/components/ConfirmDialog";
import type { ConfirmDialogOptions } from "@/shared/components/ConfirmDialog";
import RegistrationDialog from "@/shared/components/RegistrationDialog";
import type { SheetClose } from "@/shared/lib/types";
import { toast } from "@/shared/lib/toast";
import { Sheet, SheetContent, SheetTitle } from "@/shared/ui/sheet";

function SettingsContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useStore((state) => state.user);
  const setUser = useStore((state) => state.setUser);
  const pullState = useStore((state) => state.pullState);
  const resetDemo = useStore((state) => state.resetDemo);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [effortHelpOpen, setEffortHelpOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmDialogOptions | null>(null);
  const [activeSheet, setActiveSheet] = useState<SettingsSheet | null>(null);

  const closeSheet: SheetClose = () => {
    setActiveSheet(null);

    return Promise.resolve();
  };

  const requestConfirmation = (options: ConfirmDialogOptions) => setConfirmation(options);

  const signInHere = async () => {
    try {
      const u = await passkeyLogin();
      setUser(u);
      await pullState();
      toast(t("account.welcomeBack", "Welcome back, {{name}}", { name: u.name }));
    } catch (e) {
      if (e instanceof Error && e.name !== "NotAllowedError" && e.name !== "AbortError") {
        toast(e.message || t("account.signFailed", "Sign-in failed"));
      } else if (!(e instanceof Error)) {
        toast(t("account.signFailed", "Sign-in failed"));
      }
    }
  };

  return (
    <div className="mx-auto w-full max-w-160">
      <PageHeader>
        <Button
          variant="circle"
          className="flex size-9 flex-none items-center justify-center active:scale-95"
          onClick={() => void navigate({ to: "/home" })}
          aria-label={t("navigation.home", "Home")}
        >
          <Icon name="chevronLeft" />
        </Button>
        <div className="ml-2.5 min-w-0 flex-1">
          <PageTitle>{t("navigation.settings", "Settings")}</PageTitle>
        </div>
      </PageHeader>

      {/* ---------- account (demo and mobile builds have nothing to sign in to) ---------- */}
      <Section
        title={
          MOBILE
            ? t("mobile.yourData", "Your data")
            : DEMO
              ? t("account.demo.title", "Demo")
              : t("settings.account", "Account")
        }
      >
        {MOBILE ? (
          <>
            <Row
              icon="lock"
              iconTint="var(--primary)"
              title={t("mobile.allDataStaysPhone", "All data stays on this phone")}
              subtitle={t(
                "mobile.noAccountNoCloudBack",
                "No account, no cloud — back it up anytime with Export below.",
              )}
            />
            <Row
              icon="rocket"
              iconTint="var(--system-indigo)"
              title={t("account.selfHostTitle", "Self-host Set & Signal")}
              subtitle={t(
                "account.selfHostDescription",
                "Passkey sign-in, sync across your devices, your own data.",
              )}
              accessory="chevron"
              onClick={() => window.open(REPO, "_blank", "noopener")}
            />
          </>
        ) : DEMO ? (
          <>
            <Row
              icon="sparkles"
              iconTint="var(--primary)"
              title={t("account.demo.activeTitle", "You’re in the demo")}
              subtitle={t(
                "account.demo.activeDescription",
                "Example data, stored only in this browser — change anything you like.",
              )}
            />
            <Row
              icon="reset"
              iconTint="var(--system-blue)"
              title={t("account.demo.reset", "Reset demo data")}
              accessory="chevron"
              onClick={() =>
                requestConfirmation({
                  title: t("account.demo.resetPrompt", "Reset demo data?"),
                  description: t(
                    "account.demo.resetDescription",
                    "Puts the example plan, workouts and weigh-ins back the way they started.",
                  ),
                  confirmLabel: t("common.reset", "Reset"),
                  onConfirm: async () => {
                    await resetDemo();
                    void navigate({ to: "/home" }).catch(console.error);
                    toast(t("account.demo.resetSuccess", "Demo data reset"));
                  },
                })
              }
            />
            <Row
              icon="rocket"
              iconTint="var(--system-indigo)"
              title={t("account.selfHostTitle", "Self-host Set & Signal")}
              subtitle={t(
                "account.selfHostDescription",
                "Passkey sign-in, sync across your devices, your own data.",
              )}
              accessory="chevron"
              onClick={() => window.open(REPO, "_blank", "noopener")}
            />
          </>
        ) : user ? (
          <UserRows requestConfirmation={requestConfirmation} />
        ) : webauthnOK() ? (
          <>
            <Row
              icon="sparkles"
              iconTint="var(--primary)"
              title={t("settings.createPasskeyProfile", "Create passkey profile")}
              subtitle={t(
                "account.dataSeparationDescription",
                "Keeps your data safe and separate per person.",
              )}
              accessory="chevron"
              onClick={() => setRegistrationOpen(true)}
            />
            <Row
              icon="person"
              iconTint="var(--system-blue)"
              title={t("account.signPasskey", "Sign in with passkey")}
              accessory="chevron"
              onClick={() => void signInHere()}
            />
          </>
        ) : (
          <Row
            icon="lock"
            iconTint="var(--system-grey)"
            title={t(
              "settings.passkeysNotSupportedBrowser",
              "Passkeys not supported in this browser.",
            )}
          />
        )}
      </Section>
      {!user && !DEMO && !MOBILE && (
        <p className="-mt-4.5 mb-5.5 px-1 pt-2 text-sm leading-snug text-foreground/60">
          {t("account.guestModeDescription", "Guest mode — data lives only in this browser.")}
        </p>
      )}

      <GarminPanel key={user?.id ?? "guest"} />
      <SettingsPreferences onEffortHelp={() => setEffortHelpOpen(true)} />

      <SettingsData
        user={user}
        requestConfirmation={requestConfirmation}
        onOpenSheet={setActiveSheet}
      />
      <RegistrationDialog open={registrationOpen} onOpenChange={setRegistrationOpen} />
      <EffortHelpDialog open={effortHelpOpen} onOpenChange={setEffortHelpOpen} />
      {confirmation && (
        <ConfirmDialog
          {...confirmation}
          open
          onOpenChange={(open) => {
            if (!open) {
              setConfirmation(null);
            }
          }}
        />
      )}
      <Sheet
        open={activeSheet !== null}
        onOpenChange={(open) => {
          if (!open) {
            setActiveSheet(null);
          }
        }}
      >
        <SheetContent side="bottom" variant="panel" showCloseButton={false}>
          <SheetTitle className="sr-only">
            {activeSheet?.kind === "curated"
              ? t("plans.curated.title", "Curated plans")
              : t("import.importHistory", "Import history")}
          </SheetTitle>
          <div className="mx-auto mt-1.5 mb-3.5 h-1 w-9 rounded-full bg-foreground/20" />
          {activeSheet?.kind === "curated" && <CuratedPlans close={closeSheet} />}
          {activeSheet?.kind === "import" && (
            <ImportSummary parsed={activeSheet.parsed} close={closeSheet} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default function Settings() {
  return <SettingsContent />;
}
