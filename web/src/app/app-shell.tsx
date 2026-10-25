import { lazy, Suspense, useEffect, useState } from "react";
import { Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useStore } from "@/app/store/useStore";
import { useWorkoutTimer } from "@/features/workout/useWorkoutTimer";
import { DEFAULT_ACCENT, isAccent } from "@/shared/lib/accents";
import { setLang } from "@/i18n/i18n";
import { useWakeLock } from "@/shared/lib/wakelock";
import TabBar from "@/shared/components/TabBar";
import ErrorBoundary from "@/shared/components/ErrorBoundary";
import Toast from "@/shared/components/Toast";
import RestTimer from "@/shared/components/RestTimer";
import Login from "@/features/auth/LoginPage";
import { cn } from "@/shared/lib/utils";
import SyncStatus from "@/shared/components/SyncStatus";
import BrandMark from "@/shared/components/BrandMark";
import AppNavigation from "@/shared/components/AppNavigation";
import { nextPlannedRoutine } from "@/domain/training/schedule";
import { todayISO } from "@/shared/lib/format";

const loadStartWorkoutSheet = () => import("@/shared/components/StartWorkoutSheet");

const StartWorkoutSheet = lazy(loadStartWorkoutSheet);

function applyPrefs(theme: string, accent: string) {
  const de = document.documentElement;
  const isDark = theme === "dark";
  de.classList.toggle("dark", isDark);
  de.dataset.accent = isAccent(accent) ? accent : DEFAULT_ACCENT;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

  if (meta) {
    meta.content = isDark ? "#131521" : "#f6f7fb";
  }
}

export default function AppShell() {
  const navigate = useNavigate();

  const pageRouteId = useRouterState({
    select: (state) => state.matches[1]?.routeId ?? state.location.pathname,
  });

  const theme = useStore((state) => state.appState.theme);
  const accent = useStore((state) => state.appState.accent);
  const language = useStore((state) => state.appState.lang);
  const activeWorkout = useStore((state) => state.appState.active);
  const keepAwake = useStore((state) => state.appState.keepAwake);
  const user = useStore((state) => state.user);
  const isGuest = useStore((state) => state.isGuest);
  const profileLoaded = useStore((state) => state.profileLoaded);
  const isReady = useStore((state) => state.isReady);
  const isTimerVisible = useWorkoutTimer((state) => Boolean(state.timer || state.work));
  const [startRoutineId, setStartRoutineId] = useState<string | null>(null);
  const { i18n, t } = useTranslation();
  const resolvedLanguage = i18n.resolvedLanguage;

  useEffect(() => {
    applyPrefs(theme, accent);
  }, [theme, accent]);
  useEffect(() => {
    void setLang(language || "en").catch(console.error);
  }, [language]);
  useEffect(() => {
    document.documentElement.lang = resolvedLanguage || language || "en";
  }, [language, resolvedLanguage]);
  useWakeLock(!!activeWorkout && keepAwake !== false);

  useEffect(() => {
    const pending = new URLSearchParams(window.location.search).get("oauth_state");

    if (user && pending) {
      window.location.replace(`/oauth/resume?state=${encodeURIComponent(pending)}`);
    }
  }, [user]);
  const authed = user || isGuest;

  if (!isReady && !authed) {
    return (
      <div
        id="app"
        className="mx-auto max-w-xl pt-safe-app-top pr-safe-app-right pb-32 pl-safe-app-left md:max-w-3xl lg:max-w-6xl lg:px-4 lg:pt-8"
      >
        <BrandMark className="mx-auto mt-32 size-12 text-primary" title="Set & Signal" />
        <output className="mt-4 block text-center text-muted-foreground">
          {t("sync.opening", "Opening your training log…")}
        </output>
      </div>
    );
  }

  return (
    <>
      {authed && (
        <AppNavigation
          onStart={() => {
            if (user && !profileLoaded) {
              return;
            }

            if (activeWorkout) {
              void navigate({ to: "/workout" }).catch(console.error);

              return;
            }

            const routine = nextPlannedRoutine(useStore.getState().appState, todayISO());

            if (routine?.ex.length) {
              setStartRoutineId(routine.id);
            } else {
              void navigate({ to: "/workout" }).catch(console.error);
            }
          }}
        />
      )}
      <main
        id="app"
        tabIndex={-1}
        className={cn(
          authed ? "app-main" : "auth-main",
          "animate-in duration-200 ease-out fade-in slide-in-from-bottom-1",
          isTimerVisible && "pb-64!",
        )}
        key={pageRouteId}
      >
        <ErrorBoundary>
          {authed && <SyncStatus key={user?.id ?? "local"} />}
          {authed ? (
            user && !profileLoaded ? (
              <section className="training-loading" aria-busy="true">
                <BrandMark className="size-10 text-primary" />
                <h1 className="mt-6 font-heading text-3xl">
                  {t("sync.loadingProfile", "Getting your training log")}
                </h1>
                <p className="mt-3 max-w-prose text-muted-foreground">
                  {t(
                    "sync.loadingProfileDetail",
                    "Your plan and history will appear when we connect. If this is your first visit on this device, an internet connection is needed.",
                  )}
                </p>
              </section>
            ) : (
              <Outlet />
            )
          ) : (
            <Login />
          )}
        </ErrorBoundary>
      </main>
      {(!user || profileLoaded) && (
        <TabBar
          onStart={(routineId) => {
            setStartRoutineId(routineId);
          }}
          onStartIntent={() => void loadStartWorkoutSheet()}
        />
      )}
      <RestTimer />
      {startRoutineId !== null && (
        <Suspense fallback={null}>
          <StartWorkoutSheet
            open
            routineId={startRoutineId}
            onOpenChange={(open) => {
              if (!open) {
                setStartRoutineId(null);
              }
            }}
          />
        </Suspense>
      )}
      <Toast />
    </>
  );
}
