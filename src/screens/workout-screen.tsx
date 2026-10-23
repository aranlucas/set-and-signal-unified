import { loadPlates } from "../domain/plates";
import { useAppState } from "../data/store";
import { setNotes } from "../data/actions";
import { count, sessionDate, workoutDate } from "../domain/format";
import { useState } from "react";
import MoreIcon from "@expo/material-symbols/more_vert.xml";
import {
  Column,
  Icon,
  IconButton,
  Row,
  Text,
  TextButton,
  ModalBottomSheet,
  FilledTonalButton,
  LinearProgressIndicator,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import {
  defaultMinSize,
  fillMaxWidth,
  paddingAll,
  weight,
  semantics,
  verticalScroll,
} from "@expo/ui/jetpack-compose/modifiers";
import {
  Action,
  Caption,
  Choices,
  Divider,
  Field,
  Heading,
  Page,
  Panel,
  SectionTitle,
} from "../components/ui";
import { SetCounters } from "../components/set-counters";
import { WeekStrip } from "../components/week-strip";
import {
  NAMES,
  ROUTINE,
  formatWeight,
  loggedSets,
  totalSets,
  type Lift,
  type Unit,
  type WorkoutKind,
} from "../domain/workout";

export interface WorkoutProps {
  onStart: () => void;
  onLog: (lift: Lift, index: number, reps: number | null) => void;
  onWeight: (lift: Lift) => void;
  onTools: (lift: Lift) => void;
  onDiscard: () => void;
  onSwitch: () => void;
  onSetup: () => void;
  onUnit: (unit: Unit) => void;
}

interface EditingSet {
  lift: Lift;
  index: number;
}

interface WorkoutNotesProps {
  onDiscard: () => void;
  showNotes: boolean;
  setShowNotes: (show: boolean) => void;
}

interface ExerciseSelection {
  lift: Lift;
  index: number;
}

interface ExerciseActions {
  onWeight: WorkoutProps["onWeight"];
  onTools: WorkoutProps["onTools"];
  onLog: WorkoutProps["onLog"];
  onEdit: (selection: ExerciseSelection) => void;
}

interface ActiveExercisesProps extends ExerciseActions {
  kind: WorkoutKind;
}

interface ExerciseCardProps extends ExerciseActions {
  lift: Lift;
}

export function WorkoutScreen({
  onStart,
  onLog,
  onWeight,
  onTools,
  onDiscard,
  onSwitch,
  onSetup,
  onUnit,
}: WorkoutProps) {
  const id = useAppState((s) => s.active?.id);
  const kind = useAppState((s) => s.active?.kind);
  const startedAt = useAppState((s) => s.active?.startedAt);
  const logged = useAppState((s) => (s.active ? loggedSets(s.active) : 0));
  const total = useAppState((s) => (s.active ? totalSets(s.active) : 0));
  const settingsUnit = useAppState((s) => s.settings.unit);
  const history = useAppState((s) => s.history);
  const plans = useAppState((s) => s.plans);
  const next = useAppState((s) => s.next);
  const onboarded = useAppState((s) => s.onboarded);
  const c = useMaterialColors();
  const [editing, setEditing] = useState<EditingSet | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const active = id !== undefined;

  const editingReps = useAppState((s) =>
    editing
      ? s.active?.exercises.find((e) => e.lift === editing.lift)?.sets[editing.index]
      : undefined,
  );

  const record = (lift: Lift, index: number, reps: number | null) => {
    onLog(lift, index, reps);
    setEditing(null);
  };

  return (
    <>
      <Page key={id ?? "next-workout"}>
        {active && startedAt !== undefined ? (
          <Column verticalArrangement={{ spacedBy: 8 }}>
            <Row modifiers={[fillMaxWidth()]} horizontalArrangement="spaceBetween">
              <Caption>{workoutDate(startedAt)}</Caption>
              <Text color={c.primary} style={{ typography: "labelLarge" }}>
                {logged} / {total} sets
              </Text>
            </Row>
            <LinearProgressIndicator progress={logged / total} modifiers={[fillMaxWidth()]} />
          </Column>
        ) : null}
        {!onboarded ? (
          <Panel>
            <SectionTitle>Set your starting weights</SectionTitle>
            <Choices
              values={[
                { value: "lb", label: "Pounds" },
                { value: "kg", label: "Kilograms" },
              ]}
              value={settingsUnit}
              onChange={onUnit}
            />
            <Action onPress={onSetup} secondary>
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
                <Heading large>Workout {next}</Heading>
              </Column>
              <TextButton onClick={onSwitch}>
                <Text>Switch A / B</Text>
              </TextButton>
            </Row>
            <Divider />
            {ROUTINE[next].map((lift) => (
              <Row
                key={lift}
                modifiers={[fillMaxWidth()]}
                horizontalArrangement="spaceBetween"
                verticalAlignment="center"
              >
                <Column modifiers={[weight(1)]} verticalArrangement={{ spacedBy: 2 }}>
                  <SectionTitle>{NAMES[lift]}</SectionTitle>
                  <Caption>{lift === "deadlift" ? "1 × 5" : "5 × 5"} reps</Caption>
                </Column>
                <TextButton
                  onClick={() => onWeight(lift)}
                  modifiers={[
                    semantics({
                      contentDescription: `Edit ${NAMES[lift]} weight`,
                    }),
                  ]}
                >
                  <Text style={{ typography: "titleMedium", fontWeight: "600" }}>
                    {formatWeight(plans[lift].weight)} {settingsUnit}
                  </Text>
                </TextButton>
              </Row>
            ))}
            <Action onPress={onStart}>Start workout {next}</Action>
          </Panel>
        ) : null}
        {!active ? <WeekStrip history={history} /> : null}
        {active && kind ? (
          <ActiveExercises
            kind={kind}
            onWeight={onWeight}
            onTools={onTools}
            onLog={onLog}
            onEdit={setEditing}
          />
        ) : null}
        {active ? (
          <WorkoutNotes onDiscard={onDiscard} showNotes={showNotes} setShowNotes={setShowNotes} />
        ) : (
          <>
            {history[0] ? (
              <>
                <SectionTitle>Last workout</SectionTitle>
                <Panel>
                  <SectionTitle>Workout {history[0].kind}</SectionTitle>
                  <Caption>
                    {sessionDate(history[0])} · {count(loggedSets(history[0]), "set")}
                  </Caption>
                  <Caption>
                    {history[0].exercises
                      .map((e) => `${NAMES[e.lift]} ${formatWeight(e.weight)} ${history[0].unit}`)
                      .join(" · ")}
                  </Caption>
                </Panel>
              </>
            ) : null}
            {history.length === 0 ? <Caption>Alternate A and B, three days a week.</Caption> : null}
          </>
        )}
      </Page>
      {editing ? (
        <ModalBottomSheet onDismissRequest={() => setEditing(null)} skipPartiallyExpanded>
          <Column
            modifiers={[fillMaxWidth(), paddingAll(24), verticalScroll()]}
            verticalArrangement={{ spacedBy: 16 }}
          >
            <Heading>
              {NAMES[editing.lift]} · Set {editing.index + 1}
            </Heading>
            <Caption>
              {(editingReps ?? null) === null
                ? "Not logged."
                : `Logged: ${count(editingReps ?? 0, "rep")}.`}
            </Caption>
            <Column verticalArrangement={{ spacedBy: 8 }}>
              {[
                [5, 4, 3],
                [2, 1, 0],
              ].map((row) => (
                <Row
                  key={row[0]}
                  modifiers={[fillMaxWidth()]}
                  horizontalArrangement={{ spacedBy: 8 }}
                >
                  {row.map((reps) => (
                    <FilledTonalButton
                      key={reps}
                      modifiers={[weight(1), defaultMinSize({ minHeight: 56 })]}
                      colors={
                        editingReps === reps
                          ? {
                              containerColor: c.primary,
                              contentColor: c.onPrimary,
                            }
                          : undefined
                      }
                      onClick={() => record(editing.lift, editing.index, reps)}
                    >
                      <Text style={{ typography: "titleMedium" }} maxLines={1}>
                        {reps} {reps === 1 ? "rep" : "reps"}
                      </Text>
                    </FilledTonalButton>
                  ))}
                </Row>
              ))}
            </Column>
            <Action onPress={() => record(editing.lift, editing.index, null)} subtle>
              Clear set
            </Action>
          </Column>
        </ModalBottomSheet>
      ) : null}
    </>
  );
}

function WorkoutNotes({ onDiscard, showNotes, setShowNotes }: WorkoutNotesProps) {
  const notes = useAppState((s) => s.active?.notes ?? "");
  const c = useMaterialColors();

  return (
    <Column verticalArrangement={{ spacedBy: 8 }}>
      <Caption>Tap + to log a set. Tap it again to edit.</Caption>
      <Divider />
      <Row modifiers={[fillMaxWidth()]} horizontalArrangement="spaceBetween">
        <TextButton onClick={() => setShowNotes(!showNotes)}>
          <Text>{showNotes ? "Hide note" : notes ? "Edit note" : "Add note"}</Text>
        </TextButton>
        <TextButton onClick={onDiscard}>
          <Text color={c.error}>Discard</Text>
        </TextButton>
      </Row>
      {showNotes ? (
        <Field label="Workout note" multiline value={notes} onChange={setNotes} />
      ) : null}
    </Column>
  );
}

function ActiveExercises({ kind, ...actions }: ActiveExercisesProps) {
  return (
    <>
      {ROUTINE[kind].map((lift) => (
        <ExerciseCard key={lift} lift={lift} {...actions} />
      ))}
    </>
  );
}

function ExerciseCard({ lift, onWeight, onTools, onLog, onEdit }: ExerciseCardProps) {
  const e = useAppState((s) => s.active?.exercises.find((exercise) => exercise.lift === lift));

  const previous = useAppState((s) =>
    s.history.find((session) => session.exercises.some((exercise) => exercise.lift === lift)),
  );

  const unit = useAppState((s) => s.active?.unit);
  const inventory = useAppState((s) => s.settings.plates);
  const bar = useAppState((s) => s.settings.bar);

  if (!e) {
    return null;
  }

  const load = inventory && unit ? loadPlates(e.weight, bar, unit, inventory) : null;
  const last = previous?.exercises.find((x) => x.lift === e.lift);
  const previousUnit = previous?.unit;
  const done = e.sets.every((r) => r !== null);

  return (
    <Panel>
      <Row
        modifiers={[fillMaxWidth()]}
        horizontalArrangement="spaceBetween"
        verticalAlignment="center"
      >
        <Column modifiers={[weight(1)]} verticalArrangement={{ spacedBy: 2 }}>
          <Text style={{ typography: "titleMedium", fontWeight: "600" }}>{NAMES[e.lift]}</Text>
          <Caption>
            {e.sets.length} × 5 reps{done ? " · Logged" : ""}
          </Caption>
        </Column>
        <TextButton
          onClick={() => onWeight(e.lift)}
          modifiers={[
            semantics({
              contentDescription: `Edit ${NAMES[e.lift]} weight`,
            }),
          ]}
        >
          <Text style={{ typography: "titleLarge", fontWeight: "600" }}>
            {formatWeight(e.weight)} {unit}
          </Text>
        </TextButton>
        <IconButton onClick={() => onTools(e.lift)}>
          <Icon source={MoreIcon} contentDescription={`Warm-up & plates for ${NAMES[e.lift]}`} />
        </IconButton>
      </Row>
      <SetCounters
        exercise={e}
        onPress={(i) =>
          e.sets[i] === null ? onLog(e.lift, i, 5) : onEdit({ lift: e.lift, index: i })
        }
      />
      {load && unit && !load.exact ? (
        <Caption>
          {load.below
            ? `Your plates load ${formatWeight(load.below.loaded)} ${unit}, not ${formatWeight(e.weight)} ${unit}.`
            : `Your plates can't load ${formatWeight(e.weight)} ${unit}.`}
        </Caption>
      ) : null}
      <Caption>
        {last && previousUnit
          ? `Last: ${formatWeight(last.weight)} ${previousUnit} · ${last.sets.map((r) => r ?? "–").join("/")}`
          : "No previous session"}
      </Caption>
    </Panel>
  );
}
