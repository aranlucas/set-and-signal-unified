import { useEffect, useRef, useState } from "react";
import { AppState as NativeAppState } from "react-native";
import * as Haptics from "expo-haptics";
import {
  Column,
  Row,
  Text,
  TextButton,
  LinearProgressIndicator,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import {
  fillMaxWidth,
  padding,
  weight,
} from "@expo/ui/jetpack-compose/modifiers";
import { type Rest } from "../domain/workout";

export function RestTimer({
  rest,
  haptics,
  nextLabel,
  onExtend,
  onSkip,
}: {
  rest: Rest;
  haptics: boolean;
  nextLabel: string;
  onExtend: () => void;
  onSkip: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  const announced = useRef(false);
  const c = useMaterialColors();
  const remaining = Math.max(0, Math.ceil((rest.endsAt - now) / 1000));
  useEffect(() => {
    announced.current = false;
    // Wake exactly when the displayed second changes, aligned to the deadline,
    // instead of polling: one native text/progress update per second, no drift.
    let tick: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const t = Date.now();
      setNow(t);
      const left = rest.endsAt - t;
      if (left <= 0) return;
      tick = setTimeout(schedule, (left % 1000 || 1000) + 5);
    };
    tick = setTimeout(schedule, 0);
    const listener = NativeAppState.addEventListener("change", (status) => {
      if (status !== "active") return;
      clearTimeout(tick);
      schedule();
    });
    return () => {
      clearTimeout(tick);
      listener.remove();
    };
  }, [rest.endsAt]);
  useEffect(() => {
    if (remaining === 0 && !announced.current) {
      announced.current = true;
      if (haptics && NativeAppState.currentState === "active")
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
    }
  }, [remaining, haptics]);
  return (
    <Column
      modifiers={[fillMaxWidth(), padding(16, 4, 16, 2)]}
      verticalArrangement={{ spacedBy: 2 }}
    >
      <Row
        modifiers={[fillMaxWidth()]}
        horizontalArrangement="spaceBetween"
        verticalAlignment="center"
      >
        <Column modifiers={[weight(1)]}>
          <Text
            style={{ typography: "labelMedium" }}
            color={c.onSurfaceVariant}
          >
            {nextLabel}
          </Text>
          <Text style={{ typography: "titleLarge", fontWeight: "600" }}>
            {remaining
              ? `Rest ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
              : "Ready"}
          </Text>
        </Column>
        <Row>
          <TextButton onClick={onExtend}>
            <Text>+30s</Text>
          </TextButton>
          <TextButton onClick={onSkip}>
            <Text>{remaining ? "Skip" : "Done"}</Text>
          </TextButton>
        </Row>
      </Row>
      <LinearProgressIndicator
        progress={Math.max(0, Math.min(1, 1 - remaining / rest.duration))}
        modifiers={[fillMaxWidth()]}
      />
    </Column>
  );
}
