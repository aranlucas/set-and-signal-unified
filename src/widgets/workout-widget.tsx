import { Column, LinearProgressIndicator, Row, Spacer, Text } from "@expo/ui/jetpack-compose";
import {
  background,
  cornerRadius,
  fillMaxSize,
  fillMaxWidth,
  paddingAll,
  width,
} from "@expo/ui/jetpack-compose/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

export type WorkoutWidgetProps = {
  eyebrow: string;
  title: string;
  /** 0–1 during a workout, -1 when idle. */
  progress: number;
  lifts: { name: string; detail: string }[];
  footer: string;
};

// Runs in expo-widgets' own runtime: no imports, hooks, or outer constants.
const WorkoutWidget = (props: WorkoutWidgetProps, env: WidgetEnvironment) => {
  "widget";
  const dark = env.colorScheme === "dark";
  const surface = dark ? "#1B211E" : "#EAF0EB";
  const text = dark ? "#DEE4DF" : "#171D1A";
  const muted = dark ? "#BFC9C2" : "#404944";
  const accent = dark ? "#8BD6B4" : "#216B53";
  const track = dark ? "#304A3F" : "#BFE3D1";

  return (
    <Column
      modifiers={[fillMaxSize(), cornerRadius(24), background(surface), paddingAll(16)]}
      verticalArrangement={{ spacedBy: 6 }}
    >
      <Text color={muted} style={{ typography: "labelMedium" }}>
        {props.eyebrow}
      </Text>
      <Text color={text} style={{ typography: "titleLarge", fontWeight: "600" }}>
        {props.title}
      </Text>
      {props.progress >= 0 ? (
        <LinearProgressIndicator
          progress={props.progress}
          color={accent}
          trackColor={track}
          modifiers={[fillMaxWidth()]}
        />
      ) : null}
      {props.lifts.map((lift) => (
        // Glance rows only align start/center/end, so a spacer separates
        // the lift from its load instead of spaceBetween.
        <Row key={lift.name} modifiers={[fillMaxWidth()]}>
          <Text color={text} style={{ typography: "bodyMedium" }}>
            {lift.name}
          </Text>
          <Spacer modifiers={[width(8)]} />
          <Text color={accent} style={{ typography: "bodyMedium", fontWeight: "600" }}>
            {lift.detail}
          </Text>
        </Row>
      ))}
      <Text color={muted} style={{ typography: "labelSmall" }}>
        {props.footer}
      </Text>
    </Column>
  );
};

export const workoutWidget = createWidget<WorkoutWidgetProps>("WorkoutWidget", WorkoutWidget, {
  eyebrow: "Next workout",
  title: "Fivefold",
  progress: -1,
  lifts: [],
  footer: "Set up your 5×5",
});
