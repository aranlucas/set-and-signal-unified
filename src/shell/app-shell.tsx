import { AppBar } from "./app-bar";
import { AppNavigation } from "./app-navigation";
import { DialogHost } from "./dialog-host";
import { ExternalSync } from "./external-sync";
import type { Dialog, Tab } from "./types";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { BackHandler } from "react-native";
import { SnackbarHost, Column, Text, useMaterialColors } from "@expo/ui/jetpack-compose";
import { background, fillMaxSize, fillMaxWidth, padding } from "@expo/ui/jetpack-compose/modifiers";
import { Action, Caption, Heading, Page, Panel } from "../components/ui";
import { RestTimer } from "../components/rest-timer";
import { ToolsSheet, WeightSheet } from "../components/sheets";
import { getSnapshot, retry, useAppState, useStorageStatus } from "../data/store";
import * as actions from "../data/actions";
import { bindSnackbar, notify } from "../data/notices";
import type { UndoSet } from "../domain/commands";
import { nextSetLabel } from "../domain/surfaces";
import { count } from "../domain/format";
import { planPreview } from "../domain/plan-preview";
import { WorkoutScreen } from "../screens/workout-screen";
import { HistoryScreen, SessionDetail } from "../screens/history-screen";
import { ProgressScreen } from "../screens/progress-screen";
import { SettingsScreen } from "../screens/settings-screen";
import {
  NAMES,
  formatWeight,
  loggedSets,
  totalSets,
  type Lift,
  type Session,
  type WorkoutKind,
} from "../domain/workout";

export function Application() {
  const c = useMaterialColors();
  const ready = useStorageStatus("ready");
  const error = useStorageStatus("error");

  if (!ready) {
    return (
      <Column modifiers={[fillMaxSize(), background(c.background)]}>
        <Page>
          <Panel>
            <Heading>Couldn't open your data</Heading>
            <Caption>{error}</Caption>
            <Action onPress={retry}>Try again</Action>
          </Panel>
        </Page>
      </Column>
    );
  }

  return <AppShell />;
}

interface HistoryContentProps {
  selectedId: string | null;
  onBack: () => void;
  onOpen: (session: Session) => void;
  kind: "All" | WorkoutKind;
  onKind: (kind: "All" | WorkoutKind) => void;
  onDelete: (id: string) => void;
}

function AppShell() {
  const c = useMaterialColors();
  const [tab, setTab] = useState<Tab>("Train");
  const [weightLift, setWeightLift] = useState<Lift | "bar" | null>(null);
  const [toolsLift, setToolsLift] = useState<Lift | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyKind, setHistoryKind] = useState<"All" | WorkoutKind>("All");
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [undo, setUndo] = useState<UndoSet | null>(null);
  const pendingUiAction = useRef(Promise.resolve());

  const scheduleUiAction = (action: () => Promise<void>) => {
    pendingUiAction.current = pendingUiAction.current.then(action).catch(() => {
      notify("Couldn't complete that action.");
    });
  };

  const onBack = useEffectEvent(() => {
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

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => onBack());

    return () => back.remove();
  }, []);
  const openSession = (session: Session) => setSelectedId(session.id);

  const finish = () => {
    const state = getSnapshot().state;
    const active = state.active;

    if (!active || !loggedSets(active)) {
      return;
    }

    const summary = active.exercises
      .map((e) => {
        const preview = planPreview(state.plans[e.lift], e, state.settings);

        return `${NAMES[e.lift]} → ${formatWeight(preview.plan.weight)} ${active.unit}\n${preview.reason}`;
      })
      .join("\n\n");

    setDialog({
      title:
        loggedSets(active) === totalSets(active)
          ? "Finish this workout?"
          : "Save an unfinished workout?",
      text: `${loggedSets(active)} of ${totalSets(active)} sets logged.${loggedSets(active) < totalSets(active) ? " Unlogged sets count as skipped." : ""}\n\nNext time:\n${summary}`,
      confirm: "Save workout",
      action: () => {
        if (actions.finishWorkout()) {
          notify(`Workout ${active.kind} saved. Next: Workout ${active.kind === "A" ? "B" : "A"}.`);
          setTab("Train");
        }
      },
    });
  };

  const restore = async () => {
    const state = getSnapshot().state;
    const backup = await actions.readBackup();

    if (!backup) {
      return;
    }

    setDialog({
      title: "Restore this backup?",
      text: `Replace ${count(state.history.length, "workout")}${state.active ? " and an active workout" : ""} on this device with ${count(backup.history.length, "workout")} from the backup?`,
      confirm: "Replace & restore",
      destructive: true,
      action: () => {
        if (actions.restoreBackup(backup)) {
          setSelectedId(null);
          setTab("Train");
          notify("Backup restored.");
        }
      },
    });
  };

  return (
    <Column modifiers={[fillMaxSize(), background(c.background)]}>
      <ExternalSync />
      <AppBar
        tab={tab}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        setTab={setTab}
        undo={undo}
        setUndo={setUndo}
        finish={finish}
      />
      <StorageError />
      {tab === "Train" ? (
        <WorkoutScreen
          onStart={actions.startWorkout}
          onLog={(lift, index, reps) => setUndo(actions.recordSet(lift, index, reps))}
          onWeight={setWeightLift}
          onTools={setToolsLift}
          onDiscard={() =>
            setDialog({
              title: "Discard this workout?",
              text: "Logged sets and notes will be lost.",
              confirm: "Discard workout",
              destructive: true,
              action: actions.discardWorkout,
            })
          }
          onSwitch={actions.switchNext}
          onSetup={() => setTab("Settings")}
          onUnit={actions.changeWorkoutUnit}
        />
      ) : null}
      {tab === "History" ? (
        <HistoryContent
          selectedId={selectedId}
          onBack={() => setSelectedId(null)}
          onOpen={openSession}
          kind={historyKind}
          onKind={setHistoryKind}
          onDelete={(id) =>
            setDialog({
              title: "Delete this workout?",
              text: "This can't be undone.",
              confirm: "Delete workout",
              destructive: true,
              action: () => {
                if (actions.deleteWorkout(id)) {
                  setSelectedId(null);
                }
              },
            })
          }
        />
      ) : null}
      {tab === "Progress" ? <ProgressScreen /> : null}
      {tab === "Settings" ? (
        <SettingsScreen
          onSettings={actions.updateSettings}
          onUnit={actions.setUnit}
          onWeight={setWeightLift}
          onBar={() => setWeightLift("bar")}
          onAlerts={(enabled) => scheduleUiAction(() => actions.setAlerts(enabled))}
          onExport={(format) => scheduleUiAction(() => actions.exportWorkoutData(format))}
          onImport={() => scheduleUiAction(restore)}
          onDone={() => {
            if (actions.completeOnboarding()) {
              setTab("Train");
            }
          }}
        />
      ) : null}
      <RestDock />
      <SnackbarHost ref={bindSnackbar} />
      <AppNavigation tab={tab} setTab={setTab} setSelectedId={setSelectedId} />
      {weightLift ? (
        <WeightSheet
          key={weightLift}
          lift={weightLift}
          onDismiss={() => setWeightLift(null)}
          onSave={(value, increment) => {
            if (actions.saveWeight(weightLift, value, increment)) {
              setWeightLift(null);
            }
          }}
        />
      ) : null}
      {toolsLift ? <ToolsSheet lift={toolsLift} onDismiss={() => setToolsLift(null)} /> : null}
      {dialog ? <DialogHost dialog={dialog} onDismiss={() => setDialog(null)} /> : null}
    </Column>
  );
}

function StorageError() {
  const error = useStorageStatus("error");
  const c = useMaterialColors();

  return error ? (
    <Column modifiers={[fillMaxWidth(), padding(16, 8, 16, 8)]}>
      <Text color={c.error} style={{ typography: "labelLarge" }}>
        {error}
      </Text>
    </Column>
  ) : null;
}

function HistoryContent({
  selectedId,
  onBack,
  onOpen,
  kind,
  onKind,
  onDelete,
}: HistoryContentProps) {
  const selected = useAppState((s) =>
    selectedId === null ? undefined : s.history.find((session) => session.id === selectedId),
  );

  return selected ? (
    <SessionDetail session={selected} onBack={onBack} onDelete={() => onDelete(selected.id)} />
  ) : (
    <HistoryScreen onOpen={onOpen} kind={kind} onKind={onKind} />
  );
}

function RestDock() {
  const rest = useAppState((s) => s.rest);
  const haptics = useAppState((s) => s.settings.haptics);
  const nextLabel = useAppState((s) => nextSetLabel(s.active));

  return rest ? (
    <RestTimer
      rest={rest}
      haptics={haptics}
      nextLabel={nextLabel}
      onExtend={actions.extendRest}
      onSkip={actions.skipRest}
    />
  ) : null;
}
