import { useAppState } from "../data/store";
import { count, weekDate, chartDate, shortDate, date } from "../domain/format";
import { useState } from "react";
import {
  Column,
  Row,
  Text,
  TextButton,
  FlowRow,
  FilterChip,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import {
  background,
  fillMaxWidth,
  height,
  padding,
  weight,
  selectableGroup,
  semantics,
} from "@expo/ui/jetpack-compose/modifiers";
import { roundedClip } from "../components/modifiers";
import { Caption, Divider, Page, Panel, SectionTitle, StatRow } from "../components/ui";

import { LIFTS, NAMES, formatWeight, type Lift } from "../domain/workout";
import { getProgressOverview, trainingWeeks } from "../domain/progress";
import { useToday } from "../data/use-today";

export function ProgressScreen() {
  const state = {
    history: useAppState((s) => s.history),
    plans: useAppState((s) => s.plans),
    settings: { unit: useAppState((s) => s.settings.unit) },
  };

  const [selected, setSelected] = useState<Lift>("squat");
  const c = useMaterialColors();
  const today = useToday(state.history);
  const weeks = trainingWeeks(state.history, today);
  const overview = getProgressOverview(state.history, state.settings.unit);
  const { entries, best, latest } = overview[selected];
  const chart = entries.slice(-8);
  const maximum = Math.max(1, ...chart.map((e) => e.weight));

  return (
    <Page>
      <StatRow
        label={`${weeks.at(-1)?.count ?? 0} / 3 workouts this week`}
        value={`${state.history.length} total`}
      />
      <Row modifiers={[fillMaxWidth(), padding(0, 8, 0, 0)]} horizontalArrangement="spaceBetween">
        <SectionTitle>Lift records</SectionTitle>
        <Caption>Best full sets · {state.settings.unit}</Caption>
      </Row>
      <Panel>
        {LIFTS.map((lift, i) => {
          const r = overview[lift];

          return (
            <Column key={lift} verticalArrangement={{ spacedBy: 6 }}>
              {i ? <Divider /> : null}
              <Row
                modifiers={[fillMaxWidth()]}
                horizontalArrangement="spaceBetween"
                verticalAlignment="center"
              >
                <Column modifiers={[weight(1)]} verticalArrangement={{ spacedBy: 2 }}>
                  <SectionTitle>{NAMES[lift]}</SectionTitle>
                  <Caption>
                    Next {formatWeight(state.plans[lift].weight)} {state.settings.unit} ·{" "}
                    {lift === "deadlift" ? "1×5" : "5×5"}
                  </Caption>
                </Column>
                <TextButton
                  onClick={() => setSelected(lift)}
                  modifiers={[
                    semantics({
                      contentDescription: `View ${NAMES[lift]} progress`,
                    }),
                  ]}
                >
                  <Text color={c.primary} style={{ typography: "titleLarge", fontWeight: "600" }}>
                    {r.best === null ? "–" : formatWeight(r.best)}
                  </Text>
                </TextButton>
              </Row>
            </Column>
          );
        })}
      </Panel>
      <SectionTitle>Training consistency</SectionTitle>
      <Panel>
        {weeks.map((week, index) => (
          <StatRow
            key={week.start}
            label={index === weeks.length - 1 ? "This week" : `Week of ${weekDate(week.start)}`}
            value={`${week.count} / 3 workouts`}
          />
        ))}
      </Panel>
      <SectionTitle>Weight history</SectionTitle>
      <FlowRow
        modifiers={[selectableGroup()]}
        horizontalArrangement={{ spacedBy: 8 }}
        verticalArrangement={{ spacedBy: 4 }}
      >
        {LIFTS.map((lift) => (
          <FilterChip key={lift} selected={selected === lift} onClick={() => setSelected(lift)}>
            <FilterChip.Label>
              <Text>{NAMES[lift]}</Text>
            </FilterChip.Label>
          </FilterChip>
        ))}
      </FlowRow>
      <Panel>
        <SectionTitle>{NAMES[selected]}</SectionTitle>
        <StatRow
          label="Best with every rep"
          value={best === null ? "No record yet" : `${formatWeight(best)} ${state.settings.unit}`}
        />
        {latest ? (
          <Caption>
            Latest: {formatWeight(latest.weight)} {state.settings.unit} ·{" "}
            {latest.success ? "All reps completed" : "Missed or skipped reps"}
          </Caption>
        ) : null}
        {chart.length ? (
          <>
            <Caption>
              Last {count(chart.length, "session")} · weight in {state.settings.unit}
            </Caption>
            <Row
              modifiers={[fillMaxWidth()]}
              horizontalArrangement={{ spacedBy: 8 }}
              verticalAlignment="bottom"
            >
              {chart.map((e) => (
                <Column
                  key={e.id}
                  modifiers={[weight(1)]}
                  horizontalAlignment="center"
                  verticalArrangement={{ spacedBy: 6 }}
                >
                  <Text style={{ typography: "labelSmall" }}>{formatWeight(e.weight)}</Text>
                  <Column
                    modifiers={[
                      fillMaxWidth(),
                      height(Math.max(4, (96 * e.weight) / maximum)),
                      roundedClip(4),
                      background(e.success ? c.primary : c.errorContainer),
                      semantics({
                        contentDescription: `${date(e.date)}, ${formatWeight(e.weight)} ${state.settings.unit}, ${e.success ? "all reps completed" : "incomplete reps"}`,
                      }),
                    ]}
                  />
                  <Text style={{ typography: "labelSmall" }}>{chartDate(e.date)}</Text>
                </Column>
              ))}
            </Row>
            <Caption>Muted bars: missed or skipped reps.</Caption>
            <Divider />
            {entries
              .slice(-10)
              .toReversed()
              .map((e) => (
                <Row
                  key={e.id}
                  modifiers={[fillMaxWidth()]}
                  horizontalArrangement="spaceBetween"
                  verticalAlignment="center"
                >
                  <Column modifiers={[weight(1)]}>
                    <Text style={{ typography: "bodyMedium" }}>{shortDate(e.date)}</Text>
                    <Caption>{e.sets.map((r) => r ?? "–").join(" / ")} reps</Caption>
                  </Column>
                  <Text style={{ typography: "titleMedium" }}>
                    {formatWeight(e.weight)} {state.settings.unit}
                  </Text>
                </Row>
              ))}
          </>
        ) : (
          <Caption>No {NAMES[selected].toLowerCase()} workouts yet.</Caption>
        )}
      </Panel>
    </Page>
  );
}
