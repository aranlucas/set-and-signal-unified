import { useState } from "react";
import {
  Column,
  Icon,
  IconButton,
  Row,
  Text,
  TextButton,
  ModalBottomSheet,
  FlowRow,
  FilledTonalButton,
  LinearProgressIndicator,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import {
  fillMaxWidth,
  paddingAll,
  weight,
  semantics,
  verticalScroll,
} from "@expo/ui/jetpack-compose/modifiers";
import {
  Action,
  Caption,
  Divider,
  Field,
  Heading,
  Page,
  Panel,
  SectionTitle,
} from "../components/ui";
import { SetCounters } from "../components/SetCounters";
import { WeekStrip } from "../components/WeekStrip";
import {
  NAMES,
  ROUTINE,
  formatWeight,
  loggedSets,
  totalSets,
  type AppState,
  type Lift,
  type Session,
} from "../domain/workout";

export interface WorkoutProps {
  state: AppState;
  onStart: () => void;
  onLog: (lift: Lift, index: number, reps: number | null) => void;
  onWeight: (lift: Lift) => void;
  onTools: (lift: Lift) => void;
  onFinish: () => void;
  onDiscard: () => void;
  onNotes: (notes: string) => void;
  onSwitch: () => void;
  onSetup: () => void;
}
export function WorkoutScreen(p: WorkoutProps) {
  const {
    state,
    state: { active, settings },
  } = p;
  const c = useMaterialColors();
  const [showNotes, setShowNotes] = useState(false);
  const [editing, setEditing] = useState<{ lift: Lift; index: number } | null>(
    null,
  );
  const record = (lift: Lift, index: number, reps: number | null) => {
    p.onLog(lift, index, reps);
    setEditing(null);
  };
  return (
    <>
      <Page key={active?.id ?? "next-workout"}>
        {active ? (
          <Column verticalArrangement={{ spacedBy: 8 }}>
            <Row
              modifiers={[fillMaxWidth()]}
              horizontalArrangement="spaceBetween"
            >
              <Caption>
                {new Date(active.startedAt).toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </Caption>
              <Text color={c.primary} style={{ typography: "labelLarge" }}>
                {loggedSets(active)} / {totalSets(active)} sets
              </Text>
            </Row>
            <LinearProgressIndicator
              progress={loggedSets(active) / totalSets(active)}
              modifiers={[fillMaxWidth()]}
            />
          </Column>
        ) : (
          <WeekStrip history={state.history} />
        )}
        {!state.onboarded ? (
          <Panel>
            <SectionTitle>Set your starting weights</SectionTitle>
            <Caption>
              Choose kg or lb and a comfortable load for each lift.
            </Caption>
            <Action onPress={p.onSetup} secondary>
              Set up my 5×5
            </Action>
          </Panel>
        ) : null}
        {!active ? (
          <Panel>
            <Row
              modifiers={[fillMaxWidth()]}
              horizontalArrangement="spaceBetween"
              verticalAlignment="center"
            >
              <Column verticalArrangement={{ spacedBy: 4 }}>
                <Caption>Next workout</Caption>
                <Heading large>Workout {state.next}</Heading>
              </Column>
              <TextButton onClick={p.onSwitch}>
                <Text>Switch A / B</Text>
              </TextButton>
            </Row>
            <Divider />
            {ROUTINE[state.next].map((lift) => (
              <Row
                key={lift}
                modifiers={[fillMaxWidth()]}
                horizontalArrangement="spaceBetween"
                verticalAlignment="center"
              >
                <Column
                  modifiers={[weight(1)]}
                  verticalArrangement={{ spacedBy: 2 }}
                >
                  <SectionTitle>{NAMES[lift]}</SectionTitle>
                  <Caption>
                    {lift === "deadlift" ? "1 × 5" : "5 × 5"} reps
                  </Caption>
                </Column>
                <TextButton
                  onClick={() => p.onWeight(lift)}
                  modifiers={[
                    semantics({
                      contentDescription: `Edit ${NAMES[lift]} weight`,
                    }),
                  ]}
                >
                  <Text
                    style={{ typography: "titleMedium", fontWeight: "600" }}
                  >
                    {formatWeight(state.plans[lift].weight)} {settings.unit}
                  </Text>
                </TextButton>
              </Row>
            ))}
            <Action onPress={p.onStart}>Start workout {state.next}</Action>
          </Panel>
        ) : null}
        {active?.exercises.map((e) => {
          const previous = state.history.find((s) =>
            s.exercises.some((x) => x.lift === e.lift),
          );
          const last = previous?.exercises.find((x) => x.lift === e.lift);
          const done = e.sets.every((r) => r !== null);
          return (
            <Panel key={e.lift}>
              <Row
                modifiers={[fillMaxWidth()]}
                horizontalArrangement="spaceBetween"
                verticalAlignment="center"
              >
                <Column
                  modifiers={[weight(1)]}
                  verticalArrangement={{ spacedBy: 2 }}
                >
                  <Text
                    style={{ typography: "titleMedium", fontWeight: "600" }}
                  >
                    {NAMES[e.lift]}
                  </Text>
                  <Caption>
                    {e.sets.length} × 5 reps{done ? " · Logged" : ""}
                  </Caption>
                </Column>
                <TextButton
                  onClick={() => p.onWeight(e.lift)}
                  modifiers={[
                    semantics({
                      contentDescription: `Edit ${NAMES[e.lift]} weight`,
                    }),
                  ]}
                >
                  <Text style={{ typography: "titleLarge", fontWeight: "600" }}>
                    {formatWeight(e.weight)} {active.unit}
                  </Text>
                </TextButton>
                <IconButton onClick={() => p.onTools(e.lift)}>
                  <Icon
                    source={require("../../assets/more.xml")}
                    contentDescription={`Warm-up & plates for ${NAMES[e.lift]}`}
                  />
                </IconButton>
              </Row>
              <SetCounters
                exercise={e}
                onPress={(i) =>
                  e.sets[i] === null
                    ? record(e.lift, i, 5)
                    : setEditing({ lift: e.lift, index: i })
                }
              />
              <Caption>
                {last
                  ? `Last: ${formatWeight(last.weight)} ${previous!.unit} · ${last.sets.map((r) => r ?? "–").join("/")}`
                  : "No previous session"}
              </Caption>
            </Panel>
          );
        })}
        {active ? (
          <Column verticalArrangement={{ spacedBy: 8 }}>
            <Caption>Tap + to log 5 reps. Tap a logged set to edit.</Caption>
            <Divider />
            <Row
              modifiers={[fillMaxWidth()]}
              horizontalArrangement="spaceBetween"
            >
              <TextButton onClick={() => setShowNotes(!showNotes)}>
                <Text>
                  {showNotes
                    ? "Hide note"
                    : active.notes
                      ? "Edit note"
                      : "Add note"}
                </Text>
              </TextButton>
              <TextButton onClick={p.onDiscard}>
                <Text color={c.error}>Discard</Text>
              </TextButton>
            </Row>
            {showNotes ? (
              <Field
                label="Workout note"
                multiline
                value={active.notes}
                onChange={p.onNotes}
              />
            ) : null}
          </Column>
        ) : (
          <>
            <SectionTitle>Last workout</SectionTitle>
            {state.history[0] ? (
              <Panel>
                <SectionTitle>Workout {state.history[0].kind}</SectionTitle>
                <Caption>
                  {sessionDate(state.history[0])} ·{" "}
                  {loggedSets(state.history[0])} sets
                </Caption>
                <Caption>
                  {state.history[0].exercises
                    .map(
                      (e) =>
                        `${NAMES[e.lift]} ${formatWeight(e.weight)} ${state.history[0].unit}`,
                    )
                    .join(" · ")}
                </Caption>
              </Panel>
            ) : (
              <Caption>Your completed workouts will appear here.</Caption>
            )}
            <Caption>
              Alternate A and B, three times a week, with a rest day between
              sessions. Complete all reps to increase the load.
            </Caption>
          </>
        )}
      </Page>
      {editing ? (
        <ModalBottomSheet
          onDismissRequest={() => setEditing(null)}
          skipPartiallyExpanded
        >
          <Column
            modifiers={[fillMaxWidth(), paddingAll(24), verticalScroll()]}
            verticalArrangement={{ spacedBy: 16 }}
          >
            <Heading>
              {NAMES[editing.lift]} · Set {editing.index + 1}
            </Heading>
            <Caption>
              Currently:{" "}
              {active?.exercises.find((e) => e.lift === editing.lift)?.sets[
                editing.index
              ] ?? "not logged"}{" "}
              reps. Choose the correct result.
            </Caption>
            <FlowRow
              horizontalArrangement={{ spacedBy: 8 }}
              verticalArrangement={{ spacedBy: 8 }}
            >
              {[5, 4, 3, 2, 1, 0].map((reps) => (
                <FilledTonalButton
                  key={reps}
                  colors={
                    active?.exercises.find((e) => e.lift === editing.lift)
                      ?.sets[editing.index] === reps
                      ? { containerColor: c.primary, contentColor: c.onPrimary }
                      : undefined
                  }
                  onClick={() => record(editing.lift, editing.index, reps)}
                >
                  <Text>
                    {reps} {reps === 1 ? "rep" : "reps"}
                  </Text>
                </FilledTonalButton>
              ))}
            </FlowRow>
            <Action
              onPress={() => record(editing.lift, editing.index, null)}
              subtle
            >
              Clear set
            </Action>
          </Column>
        </ModalBottomSheet>
      ) : null}
    </>
  );
}
export function sessionDate(s: Session) {
  return new Date(s.finishedAt ?? s.startedAt).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
