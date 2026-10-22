import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Haptics from "expo-haptics";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import {
  AlertDialog,
  Button,
  SnackbarHost,
  type SnackbarHostRef,
  Column,
  Host,
  Icon,
  IconButton,
  NavigationBar,
  NavigationBarItem,
  Text,
  TextButton,
  TopAppBar,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import {
  background,
  fillMaxSize,
  fillMaxWidth,
} from "@expo/ui/jetpack-compose/modifiers";
import { Action, Caption, Heading, Page, Panel } from "./src/components/ui";
import { RestTimer } from "./src/components/RestTimer";
import { ToolsSheet, WeightSheet } from "./src/components/Sheets";
import { useWorkoutStore } from "./src/data/useWorkoutStore";
import { enableRestAlerts, syncRestAlert } from "./src/data/notifications";
import { exportData, importData } from "./src/data/exports";
import { WorkoutScreen } from "./src/screens/WorkoutScreen";
import { HistoryScreen, SessionDetail } from "./src/screens/HistoryScreen";
import { ProgressScreen } from "./src/screens/ProgressScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import {
  NAMES,
  changeUnit,
  finishSession,
  formatWeight,
  logSet,
  loggedSets,
  nextPlan,
  startSession,
  totalSets,
  type Lift,
  type Rest,
  type Session,
} from "./src/domain/workout";

type Tab = "Train" | "History" | "Progress" | "Settings";
type Dialog = {
  title: string;
  text: string;
  confirm: string;
  action: () => void;
  destructive?: boolean;
};
const icons = {
  Train: require("./assets/train.xml"),
  History: require("./assets/history.xml"),
  Progress: require("./assets/progress.xml"),
  Settings: require("./assets/settings.xml"),
};

export default function App() {
  const store = useWorkoutStore();
  return (
    <Host
      style={{ flex: 1 }}
      seedColor="#216B53"
      colorScheme={
        store.state.settings.theme === "system"
          ? undefined
          : store.state.settings.theme
      }
    >
      <StatusBar
        style={
          store.state.settings.theme === "dark"
            ? "light"
            : store.state.settings.theme === "light"
              ? "dark"
              : "auto"
        }
      />
      <Application {...store} />
    </Host>
  );
}

function Application({
  state,
  commit,
  error,
  ready,
  retry,
}: ReturnType<typeof useWorkoutStore>) {
  const [tab, setTab] = useState<Tab>("Train");
  const [weightLift, setWeightLift] = useState<Lift | "bar" | null>(null);
  const [toolsLift, setToolsLift] = useState<Lift | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState("");
  const [undo, setUndo] = useState<{
    sessionId: string;
    lift: Lift;
    index: number;
    reps: number | null;
    rest: Rest | null;
  } | null>(null);
  const snackbar = useRef<SnackbarHostRef>(null);
  useEffect(() => {
    if (!notice) return;
    void snackbar.current
      ?.showSnackbar({
        message: notice,
        withDismissAction: true,
        duration: "long",
      })
      .then(() => setNotice((current) => (current === notice ? "" : current)));
  }, [notice]);
  const c = useMaterialColors();
  const hasActiveWorkout = state.active !== null;
  const selected = state.history.find((s) => s.id === selectedId);
  const openSession = useCallback((s: Session) => setSelectedId(s.id), []);
  useEffect(() => {
    syncRestAlert(state.rest, state.settings.restAlerts, () =>
      setNotice(
        "Rest alerts could not be scheduled. The in-app timer still works.",
      ),
    );
  }, [state.rest, state.settings.restAlerts]);
  useEffect(() => {
    if (hasActiveWorkout && state.settings.keepAwake)
      void activateKeepAwakeAsync("fivefold-workout").catch(() => {});
    else void deactivateKeepAwake("fivefold-workout").catch(() => {});
    return () => {
      void deactivateKeepAwake("fivefold-workout").catch(() => {});
    };
  }, [hasActiveWorkout, state.settings.keepAwake]);
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (dialog) {
        setDialog(null);
        return true;
      }
      if (selectedId) {
        setSelectedId(null);
        return true;
      }
      if (tab !== "Train") {
        setTab("Train");
        return true;
      }
      return false;
    });
    return () => back.remove();
  }, [dialog, selectedId, tab]);
  const finish = () => {
    const active = state.active;
    if (!active || !loggedSets(active)) return;
    const summary = active.exercises
      .map(
        (e) =>
          `${NAMES[e.lift]} → ${formatWeight(nextPlan(state.plans[e.lift], e, state.settings).weight)} ${active.unit}`,
      )
      .join("\n");
    setDialog({
      title:
        loggedSets(active) === totalSets(active)
          ? "Finish this workout?"
          : "Save an unfinished workout?",
      text: `${loggedSets(active)} of ${totalSets(active)} sets logged.${loggedSets(active) < totalSets(active) ? " Unlogged sets will be saved as skipped. Partly skipped lifts will repeat their weight." : ""}\n\nNext time:\n${summary}`,
      confirm: "Save workout",
      action: () => {
        if (commit((s) => finishSession(s))) {
          setNotice(
            `Workout ${active.kind} saved. Next: Workout ${active.kind === "A" ? "B" : "A"}.`,
          );
          setTab("Train");
        }
      },
    });
  };
  const restore = async () => {
    try {
      const backup = await importData();
      if (!backup) return;
      setDialog({
        title: "Restore this backup?",
        text: `Replace the data on this device (${state.history.length} saved workouts${state.active ? " and an active workout" : ""}) with ${backup.history.length} workouts${backup.active ? " and the saved active workout" : ""} from the backup? Export your current data first if you want to keep it.`,
        confirm: "Replace & restore",
        destructive: true,
        action: () => {
          if (
            commit(() => ({
              ...backup,
              rest:
                backup.rest && backup.rest.endsAt > Date.now()
                  ? backup.rest
                  : null,
            }))
          ) {
            setSelectedId(null);
            setTab("Train");
            setNotice("Backup restored. Your workouts are ready.");
          }
        },
      });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not read this backup.");
    }
  };
  const alerts = async (enabled: boolean) => {
    if (!enabled) {
      commit((s) => ({ ...s, settings: { ...s.settings, restAlerts: false } }));
      return;
    }
    try {
      if (await enableRestAlerts())
        commit((s) => ({
          ...s,
          settings: { ...s.settings, restAlerts: true },
        }));
      else
        setNotice(
          "Notifications are disabled. You can enable them in Android app settings. The in-app timer works without permission.",
        );
    } catch {
      setNotice("Notifications are unavailable. The in-app timer still works.");
    }
  };
  if (!ready)
    return (
      <Column modifiers={[fillMaxSize(), background(c.background)]}>
        <Page>
          <Panel>
            <Heading>Could not open your data</Heading>
            <Caption>{error}</Caption>
            <Caption>
              Your saved data has not been replaced. Try reopening storage.
            </Caption>
            <Action onPress={retry}>Try again</Action>
          </Panel>
        </Page>
      </Column>
    );
  return (
    <Column modifiers={[fillMaxSize(), background(c.background)]}>
      <TopAppBar
        key={`${selectedId ?? "root"}-${tab}-${state.active ? "active" : "idle"}`}
        colors={{ containerColor: c.background }}
      >
        <TopAppBar.Title>
          <Text style={{ typography: "titleLarge", fontWeight: "600" }}>
            {selected
              ? "Details"
              : tab === "Train"
                ? state.active
                  ? `Workout ${state.active.kind}`
                  : "Fivefold"
                : tab}
          </Text>
        </TopAppBar.Title>
        {selected ? (
          <TopAppBar.NavigationIcon>
            <IconButton onClick={() => setSelectedId(null)}>
              <Icon
                source={require("./assets/back.xml")}
                contentDescription="Back to history"
              />
            </IconButton>
          </TopAppBar.NavigationIcon>
        ) : null}
        {state.active && tab === "Train" ? (
          <TopAppBar.Actions>
            {undo?.sessionId === state.active.id ? (
              <TextButton
                onClick={() => {
                  commit((s) =>
                    s.active?.id === undo.sessionId
                      ? {
                          ...logSet(s, undo.lift, undo.index, undo.reps),
                          rest: undo.rest,
                        }
                      : s,
                  );
                  setUndo(null);
                }}
              >
                <Text>Undo</Text>
              </TextButton>
            ) : null}
            <Button onClick={finish} enabled={loggedSets(state.active) > 0}>
              <Text>Finish</Text>
            </Button>
          </TopAppBar.Actions>
        ) : null}
        {state.active && tab !== "Train" ? (
          <TopAppBar.Actions>
            <TextButton
              onClick={() => {
                setTab("Train");
                setSelectedId(null);
              }}
            >
              <Text>Resume</Text>
            </TextButton>
          </TopAppBar.Actions>
        ) : null}
      </TopAppBar>
      {error ? (
        <Column modifiers={[fillMaxWidth()]}>
          <TextButton onClick={() => setNotice("")}>
            <Text color={error ? c.error : c.primary}>{error}</Text>
          </TextButton>
        </Column>
      ) : null}
      {tab === "Train" ? (
        <WorkoutScreen
          state={state}
          onStart={() => commit((s) => startSession({ ...s, onboarded: true }))}
          onLog={(lift, i, reps) => {
            const previous =
              state.active?.exercises.find((e) => e.lift === lift)?.sets[i] ??
              null;
            if (state.active)
              setUndo({
                sessionId: state.active.id,
                lift,
                index: i,
                reps: previous,
                rest: state.rest,
              });
            if (
              commit((s) => logSet(s, lift, i, reps)) &&
              state.settings.haptics
            )
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                () => {},
              );
          }}
          onWeight={setWeightLift}
          onTools={setToolsLift}
          onFinish={finish}
          onDiscard={() =>
            setDialog({
              title: "Discard this workout?",
              text: "The active sets and note will be removed. Your planned weights and completed history will stay as they are.",
              confirm: "Discard workout",
              destructive: true,
              action: () => commit((s) => ({ ...s, active: null, rest: null })),
            })
          }
          onNotes={(notes) =>
            commit((s) =>
              s.active ? { ...s, active: { ...s.active, notes } } : s,
            )
          }
          onSwitch={() =>
            commit((s) => ({ ...s, next: s.next === "A" ? "B" : "A" }))
          }
          onSetup={() => setTab("Settings")}
        />
      ) : null}
      {tab === "History" ? (
        selected ? (
          <SessionDetail
            session={selected}
            onBack={() => setSelectedId(null)}
            onDelete={() =>
              setDialog({
                title: "Delete this workout?",
                text: "This removes the workout from your history. Planned weights and the next workout will not change.",
                confirm: "Delete workout",
                destructive: true,
                action: () => {
                  if (
                    commit((s) => ({
                      ...s,
                      history: s.history.filter((h) => h.id !== selected.id),
                    }))
                  )
                    setSelectedId(null);
                },
              })
            }
          />
        ) : (
          <HistoryScreen state={state} onOpen={openSession} />
        )
      ) : null}
      {tab === "Progress" ? <ProgressScreen state={state} /> : null}
      {tab === "Settings" ? (
        <SettingsScreen
          state={state}
          onSettings={(settings) =>
            commit((s) => ({ ...s, settings: { ...s.settings, ...settings } }))
          }
          onUnit={(unit) => {
            if (state.active)
              setNotice(
                "Finish or discard your active workout before changing units.",
              );
            else commit((s) => changeUnit(s, unit));
          }}
          onWeight={setWeightLift}
          onBar={() => setWeightLift("bar")}
          onAlerts={(enabled) => {
            void alerts(enabled);
          }}
          onExport={(format) => {
            void exportData(
              state,
              format === "share" ? "json" : format,
              format === "share",
            )
              .then((message) => {
                if (message) setNotice(message);
              })
              .catch((e) =>
                setNotice(
                  e instanceof Error
                    ? e.message
                    : "Could not export your data.",
                ),
              );
          }}
          onImport={() => {
            void restore();
          }}
          onDone={() => {
            if (commit((s) => ({ ...s, onboarded: true }))) setTab("Train");
          }}
        />
      ) : null}
      {state.rest ? (
        <RestTimer
          rest={state.rest}
          haptics={state.settings.haptics}
          nextLabel={(() => {
            const next = state.active?.exercises.find((e) =>
              e.sets.some((r) => r === null),
            );
            return next
              ? `${NAMES[next.lift]} · Set ${next.sets.findIndex((r) => r === null) + 1}/${next.sets.length}`
              : "All sets logged";
          })()}
          onExtend={() =>
            commit((s) =>
              s.rest
                ? {
                    ...s,
                    rest: {
                      ...s.rest,
                      endsAt: Math.min(
                        Math.max(Date.now(), s.rest.endsAt) + 30000,
                        Date.now() + 3600000,
                      ),
                      duration: Math.min(3600, s.rest.duration + 30),
                    },
                  }
                : s,
            )
          }
          onSkip={() => commit((s) => ({ ...s, rest: null }))}
        />
      ) : null}
      <SnackbarHost ref={snackbar} />
      <NavigationBar containerColor={c.surfaceContainerLow}>
        {(Object.keys(icons) as Tab[]).map((t) => (
          <NavigationBarItem
            key={t}
            selected={tab === t}
            onClick={() => {
              setTab(t);
              setSelectedId(null);
            }}
          >
            <NavigationBarItem.Icon>
              <Icon source={icons[t]} />
            </NavigationBarItem.Icon>
            <NavigationBarItem.Label>
              <Text style={{ typography: "labelMedium" }}>{t}</Text>
            </NavigationBarItem.Label>
          </NavigationBarItem>
        ))}
      </NavigationBar>
      {weightLift ? (
        <WeightSheet
          key={weightLift}
          state={state}
          lift={weightLift}
          onDismiss={() => setWeightLift(null)}
          onSave={(value, increment) => {
            const lift = weightLift;
            if (
              commit((s) =>
                lift === "bar"
                  ? { ...s, settings: { ...s.settings, bar: value } }
                  : {
                      ...s,
                      plans: {
                        ...s.plans,
                        [lift]: {
                          weight: value,
                          increment: increment!,
                          failures: 0,
                        },
                      },
                      active: s.active
                        ? {
                            ...s.active,
                            exercises: s.active.exercises.map((e) =>
                              e.lift === lift ? { ...e, weight: value } : e,
                            ),
                          }
                        : null,
                    },
              )
            )
              setWeightLift(null);
          }}
        />
      ) : null}
      {toolsLift ? (
        <ToolsSheet
          state={state}
          lift={toolsLift}
          onDismiss={() => setToolsLift(null)}
        />
      ) : null}
      {dialog ? (
        <AlertDialog onDismissRequest={() => setDialog(null)}>
          <AlertDialog.Title>
            <Text>{dialog.title}</Text>
          </AlertDialog.Title>
          <AlertDialog.Text>
            <Text>{dialog.text}</Text>
          </AlertDialog.Text>
          <AlertDialog.ConfirmButton>
            <TextButton
              onClick={() => {
                const action = dialog.action;
                setDialog(null);
                action();
              }}
              colors={
                dialog.destructive ? { contentColor: c.error } : undefined
              }
            >
              <Text>{dialog.confirm}</Text>
            </TextButton>
          </AlertDialog.ConfirmButton>
          <AlertDialog.DismissButton>
            <TextButton onClick={() => setDialog(null)}>
              <Text>Cancel</Text>
            </TextButton>
          </AlertDialog.DismissButton>
        </AlertDialog>
      ) : null}
    </Column>
  );
}
