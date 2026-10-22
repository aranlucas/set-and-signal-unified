import { Column, Row, Text, useMaterialColors } from "@expo/ui/jetpack-compose";
import {
  background,
  clip,
  fillMaxWidth,
  paddingAll,
  Shapes,
  weight,
} from "@expo/ui/jetpack-compose/modifiers";
import { Caption } from "./ui";
import { weeklyCount, type Session } from "../domain/workout";

export function WeekStrip({ history }: { history: Session[] }) {
  const c = useMaterialColors();
  const today = new Date();
  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return (
    <Column verticalArrangement={{ spacedBy: 12 }}>
      <Row modifiers={[fillMaxWidth()]} horizontalArrangement="spaceBetween">
        <Text style={{ typography: "titleMedium", fontWeight: "600" }}>
          This week
        </Text>
        <Caption>{weeklyCount(history)} / 3 workouts</Caption>
      </Row>
      <Row modifiers={[fillMaxWidth()]} horizontalArrangement={{ spacedBy: 6 }}>
        {Array.from({ length: 7 }, (_, i) => {
          const date = new Date(monday);
          date.setDate(date.getDate() + i);
          const end = new Date(date);
          end.setDate(end.getDate() + 1);
          const count = history.filter(
            (s) =>
              s.finishedAt !== null &&
              s.finishedAt >= +date &&
              s.finishedAt < +end,
          ).length;
          const isToday = date.toDateString() === today.toDateString();
          return (
            <Column
              key={i}
              modifiers={[
                weight(1),
                clip(Shapes.RoundedCorner(12)),
                background(
                  count
                    ? c.primaryContainer
                    : isToday
                      ? c.surfaceContainerHighest
                      : c.surfaceContainerLow,
                ),
                paddingAll(8),
              ]}
              horizontalAlignment="center"
              verticalArrangement={{ spacedBy: 4 }}
            >
              <Text
                color={count ? c.onPrimaryContainer : c.onSurfaceVariant}
                style={{ typography: "labelSmall" }}
              >
                {["M", "T", "W", "T", "F", "S", "S"][i]}
              </Text>
              <Text
                color={count ? c.onPrimaryContainer : c.onSurface}
                style={{ typography: "titleMedium", fontWeight: "600" }}
              >
                {date.getDate()}
              </Text>
              <Text
                color={count ? c.onPrimaryContainer : c.onSurfaceVariant}
                style={{ typography: "labelSmall" }}
              >
                {count ? `${count}×` : isToday ? "Today" : "–"}
              </Text>
            </Column>
          );
        })}
      </Row>
    </Column>
  );
}
