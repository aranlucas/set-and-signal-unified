import { useAppState } from "../data/store";
import {
  Column,
  LazyColumn,
  Row,
  Text,
  TextButton,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import {
  clickable,
  clip,
  fillMaxWidth,
  semantics,
  Shapes,
  weight,
} from "@expo/ui/jetpack-compose/modifiers";
import {
  Caption,
  Choices,
  Divider,
  Heading,
  Page,
  Panel,
  SectionTitle,
  useContentInset,
} from "../components/ui";
import { SetCounters } from "../components/SetCounters";
import {
  NAMES,
  formatWeight,
  loggedSets,
  totalSets,
  volume,
  type Session,
  type WorkoutKind,
} from "../domain/workout";
import { count, sessionDate } from "../domain/format";

export function HistoryScreen({
  onOpen,
  kind,
  onKind,
}: {
  onOpen: (s: Session) => void;
  kind: "All" | WorkoutKind;
  onKind: (kind: "All" | WorkoutKind) => void;
}) {
  const state = { history: useAppState((s) => s.history) };
  const sessions =
    kind === "All"
      ? state.history
      : state.history.filter((s) => s.kind === kind);
  const inset = useContentInset();
  const renderItem = ({ item: s }: { item: Session }) => (
    <Column
      modifiers={[
        fillMaxWidth(),
        // Clip first so the native ripple follows the card's rounded shape.
        clip(Shapes.RoundedCorner(16)),
        clickable(() => onOpen(s)),
        semantics({
          contentDescription: `Open workout ${s.kind}, ${sessionDate(s)}`,
        }),
      ]}
    >
      <Panel>
        <Column verticalArrangement={{ spacedBy: 2 }}>
          <SectionTitle>Workout {s.kind}</SectionTitle>
          <Caption>
            {sessionDate(s)} · {duration(s)} min · {loggedSets(s)}/
            {totalSets(s)} sets
          </Caption>
        </Column>
        <Divider />
        {s.exercises.map((e) => (
          <Row
            key={e.lift}
            modifiers={[fillMaxWidth()]}
            horizontalArrangement={{ spacedBy: 12 }}
          >
            <Text modifiers={[weight(1)]} style={{ typography: "bodyMedium" }}>
              {NAMES[e.lift]}
            </Text>
            <Text style={{ typography: "bodyMedium", fontWeight: "600" }}>
              {formatWeight(e.weight)} {s.unit} ·{" "}
              {e.sets.every((r) => r === 5)
                ? `${e.sets.length}×5`
                : e.sets.every((r) => r === null)
                  ? "Skipped"
                  : e.sets.map((r) => r ?? "–").join("/")}
            </Text>
          </Row>
        ))}
        {s.notes ? (
          <Caption>
            {s.notes.length > 90 ? `${s.notes.slice(0, 90)}…` : s.notes}
          </Caption>
        ) : null}
      </Panel>
    </Column>
  );
  return (
    <LazyColumn
      modifiers={[weight(1), fillMaxWidth()]}
      contentPadding={{ start: inset, end: inset, top: 8, bottom: 24 }}
      verticalArrangement={{ spacedBy: 12 }}
    >
      <Caption>{count(state.history.length, "saved workout")}</Caption>
      <Choices
        values={[
          { value: "All", label: "All" },
          { value: "A", label: "A" },
          { value: "B", label: "B" },
        ]}
        value={kind}
        onChange={onKind}
      />
      {kind !== "All" ? (
        <Caption>
          {count(sessions.length, "workout")} {kind}
        </Caption>
      ) : null}
      {!state.history.length ? (
        <Panel>
          <Heading>No workouts yet</Heading>
          <Caption>Finished workouts show up here.</Caption>
        </Panel>
      ) : null}
      {state.history.length > 0 && sessions.length === 0 ? (
        <Panel>
          <Heading>No workout {kind} yet</Heading>
        </Panel>
      ) : null}
      <LazyColumn.Items
        data={sessions}
        keyExtractor={historyKey}
        estimatedItemSize={230}
      >
        {renderItem}
      </LazyColumn.Items>
    </LazyColumn>
  );
}
const historyKey = (s: Session) => s.id;
const duration = (s: Session) =>
  Math.max(
    1,
    Math.round(((s.finishedAt ?? s.startedAt) - s.startedAt) / 60000),
  );

export function SessionDetail({
  session,
  onDelete,
  onBack,
}: {
  session: Session;
  onDelete: () => void;
  onBack: () => void;
}) {
  const c = useMaterialColors();
  return (
    <Page>
      <Column verticalArrangement={{ spacedBy: 4 }}>
        <Heading large>Workout {session.kind}</Heading>
        <Caption>{sessionDate(session)}</Caption>
        <Caption>
          {duration(session)} min · {count(loggedSets(session), "set")} ·{" "}
          {formatWeight(volume(session))} {session.unit} volume
        </Caption>
      </Column>
      {session.exercises.map((e) => (
        <Panel key={e.lift}>
          <Row
            modifiers={[fillMaxWidth()]}
            horizontalArrangement="spaceBetween"
            verticalAlignment="center"
          >
            <Column modifiers={[weight(1)]}>
              <SectionTitle>{NAMES[e.lift]}</SectionTitle>
            </Column>
            <Text style={{ typography: "titleLarge", fontWeight: "600" }}>
              {formatWeight(e.weight)} {session.unit}
            </Text>
          </Row>
          <SetCounters exercise={e} />
        </Panel>
      ))}
      {session.notes ? (
        <Panel>
          <SectionTitle>Workout note</SectionTitle>
          <Text>{session.notes}</Text>
        </Panel>
      ) : null}
      <Caption>– skipped · 0 no reps</Caption>
      <Row modifiers={[fillMaxWidth()]} horizontalArrangement="spaceBetween">
        <TextButton onClick={onBack}>
          <Text>Back to history</Text>
        </TextButton>
        <TextButton onClick={onDelete}>
          <Text color={c.error}>Delete workout</Text>
        </TextButton>
      </Row>
    </Page>
  );
}
