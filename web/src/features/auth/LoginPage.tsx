import { useTranslation } from "react-i18next";
import { useStore } from "@/app/store/useStore";
import { getConfig, webauthnOK, passkeyLogin, BIO } from "@/shared/lib/api";
import { DEMO, REPO } from "@/shared/lib/demo";
import { lazy, Suspense, useEffect, useState } from "react";
import Icon from "@/shared/components/Icon";
import { SpaceBetween } from "@/shared/components/SpaceBetween";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/lib/toast";
import BrandMark from "@/shared/components/BrandMark";

const loadRegistrationDialog = () => import("@/shared/components/RegistrationDialog");

const RegistrationDialog = lazy(loadRegistrationDialog);

const PROVIDER_LABELS = new Map<string, string>(
  Object.entries({
    google: "Google",
    github: "GitHub",
    apple: "Apple",
  } satisfies Record<string, string>),
);

export default function Login() {
  const { t } = useTranslation();
  const setUser = useStore((state) => state.setUser);
  const pullState = useStore((state) => state.pullState);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [oidcProviders, setOidcProviders] = useState<string[]>([]);

  useEffect(() => {
    if (DEMO) {
      return;
    }

    void getConfig()
      .then((c) => setOidcProviders(c.oidc_providers ?? []))
      .catch(() => setOidcProviders([]));
  }, []);

  const signIn = async () => {
    try {
      const u = await passkeyLogin();
      setUser(u);
      await pullState();
      toast(t("account.welcomeBack", "Welcome back, {{name}}", { name: u.name }));
    } catch (e) {
      if (e instanceof Error && (e.name === "NotAllowedError" || e.name === "AbortError")) {
        return;
      }

      toast(
        e instanceof Error && e.message ? e.message : t("account.signFailed", "Sign-in failed"),
      );
    }
  };

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-160 flex-col justify-center text-center">
        <BrandMark className="mx-auto size-18 text-primary" />
        <h1 className="mt-3 mb-1 font-heading text-4xl font-semibold tracking-tight">
          Set &amp; Signal
        </h1>
        <div className="mb-7.5 text-foreground/60">
          {t("account.demo.localOnlySummary", "Live demo — everything stays in this browser.")}
        </div>
        <Button variant="default" onClick={() => useStore.getState().setGuest(true)}>
          <Icon name="sparkles" />
          {t("account.demo.start", "Start the demo")}
        </Button>
        <div className="mt-4 mb-3 rounded-lg bg-card p-4 text-left text-sm leading-snug text-foreground/60">
          {t(
            "account.demo.description",
            "This demo runs entirely in your browser on example data — nothing is sent anywhere. Passkey sign-in and sync across your devices come with the Set & Signal server, which you get by self-hosting it.",
          )}
        </div>
        <div className="mt-5.5 text-sm leading-relaxed text-muted-foreground">
          <a href={REPO} target="_blank" rel="noreferrer">
            {t("account.selfHostCta", "Self-host it in a minute →")}
          </a>
        </div>
      </div>
    );
  }

  const hasOidc = oidcProviders.length > 0;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-160 flex-col justify-center text-center">
      <BrandMark className="mx-auto size-18 text-primary" />
      <h1 className="mt-3 mb-1 font-heading text-4xl font-semibold tracking-tight">
        Set &amp; Signal
      </h1>
      <div className="mb-8.5 text-foreground/60">
        {t("account.tagline", "Your training, set by set.")}
      </div>

      {hasOidc && (
        <>
          {oidcProviders.map((id) => (
            <Button
              key={id}
              variant="default"
              className="mb-2.5"
              onClick={() => {
                const pending = new URLSearchParams(window.location.search).get("oauth_state");
                const next = pending ? `/?oauth_state=${encodeURIComponent(pending)}` : "/";
                window.location.href = `/oauth/web/${encodeURIComponent(id)}?next=${encodeURIComponent(next)}`;
              }}
            >
              <Icon name="person" />
              {t("account.signWith", "Sign in with {{provider}}", {
                provider: PROVIDER_LABELS.get(id) ?? id,
              })}
            </Button>
          ))}
          <div className="mb-4 text-sm text-muted-foreground">
            {t(
              "account.oidcSyncHint",
              "Same account syncs to the web app and MCP agents (Grok, Cursor).",
            )}
          </div>
        </>
      )}

      {webauthnOK() && (
        <SpaceBetween size="s">
          {hasOidc && (
            <div className="text-xs tracking-wide text-muted-foreground uppercase">
              {t("account.orPasskey", "Or use a passkey")}
            </div>
          )}
          <Button variant={hasOidc ? "outline" : "default"} onClick={() => void signIn()}>
            <Icon name="person" />
            {t("account.signPasskey", "Sign in with passkey")}
          </Button>
          <Button
            onClick={() => setRegistrationOpen(true)}
            onPointerEnter={() => void loadRegistrationDialog()}
            onFocus={() => void loadRegistrationDialog()}
          >
            <Icon name="sparkles" />
            {t("account.createNewProfile", "Create new profile")}
          </Button>
        </SpaceBetween>
      )}

      {!hasOidc && !webauthnOK() && (
        <div className="mb-3 rounded-lg bg-card p-4 text-left text-sm leading-snug text-foreground/60">
          {t(
            "account.configureOidc",
            "Configure GOOGLE_CLIENT_ID / GITHUB_CLIENT_ID (or Apple) on the server to enable sign-in.",
          )}
        </div>
      )}

      <div className="mt-6.5 text-sm leading-relaxed text-muted-foreground">
        {hasOidc
          ? t(
              "account.oidcNoPasswords",
              "Sign in with your identity provider — no local guest mode. Data lives on the server and syncs to agents via MCP.",
            )
          : t("account.passkeysUseNoPasswords", "Passkeys use {{provider}} — no passwords.", {
              provider: BIO,
            })}
        <br />
        {t(
          "account.eachProfileKeepsOwnPlan",
          "Each profile keeps its own plan, workouts & body weight.",
        )}
      </div>
      {registrationOpen && (
        <Suspense fallback={null}>
          <RegistrationDialog open onOpenChange={setRegistrationOpen} />
        </Suspense>
      )}
    </div>
  );
}
