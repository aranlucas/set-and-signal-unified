import { Column, LinearProgressIndicator, Text } from "@expo/ui/jetpack-compose";
import { fillMaxWidth } from "@expo/ui/jetpack-compose/modifiers";
import { createCustomNotification, type CustomNotificationEnvironment } from "expo-widgets";

export type WorkoutNotificationProps = {
  title: string;
  status: string;
  /** 0–1 share of logged sets. */
  progress: number;
};

// Runs in expo-widgets' own runtime: no imports, hooks, or outer constants.
const WorkoutNotificationLayout = (
  props: WorkoutNotificationProps,
  env: CustomNotificationEnvironment,
) => {
  "widget";
  const text = env.colorScheme === "dark" ? "#DEE4DF" : "#171D1A";
  const muted = env.colorScheme === "dark" ? "#BFC9C2" : "#404944";
  const accent = env.colorScheme === "dark" ? "#8BD6B4" : "#216B53";

  return {
    collapsed: (
      <Column modifiers={[fillMaxWidth()]}>
        <Text color={text} style={{ typography: "titleSmall", fontWeight: "600" }}>
          {props.title}
        </Text>
        <Text color={muted} style={{ typography: "bodySmall" }}>
          {props.status}
        </Text>
      </Column>
    ),
    expanded: (
      <Column modifiers={[fillMaxWidth()]} verticalArrangement={{ spacedBy: 6 }}>
        <Text color={text} style={{ typography: "titleSmall", fontWeight: "600" }}>
          {props.title}
        </Text>
        <Text color={muted} style={{ typography: "bodySmall" }}>
          {props.status}
        </Text>
        <LinearProgressIndicator
          progress={props.progress}
          color={accent}
          trackColor={env.colorScheme === "dark" ? "#304A3F" : "#BFE3D1"}
          modifiers={[fillMaxWidth()]}
        />
      </Column>
    ),
  };
};

export const WorkoutNotification = createCustomNotification(
  "WorkoutNotification",
  WorkoutNotificationLayout,
);
