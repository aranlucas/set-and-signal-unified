import { useState } from "react";
import {
  Column,
  Row,
  Text,
  TextButton,
  FlowRow,
  FilledTonalButton,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import {
  background,
  clip,
  fillMaxWidth,
  height,
  padding,
  Shapes,
  weight,
  semantics,
} from "@expo/ui/jetpack-compose/modifiers";
import {
  Caption,
  Divider,
  Page,
  Panel,
  SectionTitle,
  StatRow,
} from "../components/ui";

import {
  LIFTS,
  NAMES,
  formatWeight,
  weeklyCount,
  type AppState,
  type Lift,
} from "../domain/workout";
import { liftRecord } from "../domain/progress";

export function ProgressScreen({ state }: { state: AppState }) {
  const [selected, setSelected] = useState<Lift>("squat");
  const c = useMaterialColors();
  const { entries, best } = liftRecord(state, selected);
  const chart = entries.slice(-8);
  const maximum = Math.max(1, ...chart.map((e) => e.weight));
  return (
    <Page>
      <StatRow
        label={`${weeklyCount(state.history)} / 3 workouts this week`}
        value={`${state.history.length} total`}
      />
      <Row
        modifiers={[fillMaxWidth(), padding(0, 8, 0, 0)]}
        horizontalArrangement="spaceBetween"
      >
        <SectionTitle>Lift records</SectionTitle>
        <Caption>Best full sets · {state.settings.unit}</Caption>
      </Row>
      <Panel>
        {LIFTS.map((lift, i) => {
          const r = liftRecord(state, lift);
          return (
            <Column key={lift} verticalArrangement={{ spacedBy: 6 }}>
              {i ? <Divider /> : null}
              <Row
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
                    Next {formatWeight(state.plans[lift].weight)}{" "}
                    {state.settings.unit} ·{" "}
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
                  <Text
                    color={c.primary}
                    style={{ typography: "titleLarge", fontWeight: "600" }}
                  >
                    {r.best === null ? "–" : formatWeight(r.best)}
                  </Text>
                </TextButton>
              </Row>
            </Column>
          );
        })}
      </Panel>
      <SectionTitle>Weight history</SectionTitle>
      <FlowRow
        horizontalArrangement={{ spacedBy: 8 }}
        verticalArrangement={{ spacedBy: 4 }}
      >
        {LIFTS.map((lift) => (
          <FilledTonalButton
            key={lift}
            onClick={() => setSelected(lift)}
            colors={
              selected === lift
                ? { containerColor: c.primary, contentColor: c.onPrimary }
                : undefined
            }
          >
            <Text>{NAMES[lift]}</Text>
          </FilledTonalButton>
        ))}
      </FlowRow>
      <Panel>
        <SectionTitle>{NAMES[selected]}</SectionTitle>
        <StatRow
          label="Best completed prescription"
          value={
            best === null
              ? "No record yet"
              : `${formatWeight(best)} ${state.settings.unit}`
          }
        />
        {chart.length ? (
          <>
            <Caption>
              Last {chart.length} sessions · weight in {state.settings.unit}
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
                  <Text style={{ typography: "labelSmall" }}>
                    {formatWeight(e.weight)}
                  </Text>
                  <Column
                    modifiers={[
                      fillMaxWidth(),
                      height(Math.max(4, (96 * e.weight) / maximum)),
                      clip(Shapes.RoundedCorner(4)),
                      background(e.success ? c.primary : c.errorContainer),
                      semantics({
                        contentDescription: `${new Date(e.date).toLocaleDateString()}, ${formatWeight(e.weight)} ${state.settings.unit}, ${e.success ? "all reps completed" : "incomplete reps"}`,
                      }),
                    ]}
                  />
                  <Text style={{ typography: "labelSmall" }}>
                    {new Date(e.date).toLocaleDateString(undefined, {
                      month: "numeric",
                      day: "numeric",
                    })}
                  </Text>
                </Column>
              ))}
            </Row>
            <Caption>
              Full-height scale starts at zero. Accent = all reps; muted =
              missed or skipped reps.
            </Caption>
            <Divider />
            {entries
              .slice(-10)
              .reverse()
              .map((e) => (
                <Row
                  key={e.id}
                  modifiers={[fillMaxWidth()]}
                  horizontalArrangement="spaceBetween"
                  verticalAlignment="center"
                >
                  <Column modifiers={[weight(1)]}>
                    <Text style={{ typography: "bodyMedium" }}>
                      {new Date(e.date).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </Text>
                    <Caption>
                      {e.sets.map((r) => r ?? "–").join(" / ")} reps
                    </Caption>
                  </Column>
                  <Text style={{ typography: "titleMedium" }}>
                    {formatWeight(e.weight)} {state.settings.unit}
                  </Text>
                </Row>
              ))}
          </>
        ) : (
          <Caption>
            Complete a workout with {NAMES[selected].toLowerCase()} to see your
            history.
          </Caption>
        )}
      </Panel>
      <Caption>
        Records require every prescribed rep. Missed and skipped sets stay
        visible in history. Previous weights are converted to your current unit.
      </Caption>
    </Page>
  );
}
