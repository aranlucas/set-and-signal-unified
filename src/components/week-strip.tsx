import { mondayWeekStart } from "../domain/calendar";
import { Column, Row, Text, useMaterialColors } from "@expo/ui/jetpack-compose";
import { background, fillMaxWidth, paddingAll, weight } from "@expo/ui/jetpack-compose/modifiers";
import { roundedClip } from "./modifiers";
import { Caption } from "./ui";
import { type Session } from "../domain/workout";
import { useToday } from "../data/use-today";

interface WeekStripProps {
  history: Session[];
}

export function WeekStrip({ history }: WeekStripProps) {
  const c = useMaterialColors();
  const today = useToday(history);

  const days = (() => {
    const monday = mondayWeekStart(today);

    const result = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(monday);
      date.setDate(date.getDate() + i);
      const end = new Date(date);
      end.setDate(end.getDate() + 1);

      return { date, end, count: 0 };
    });

    for (const session of history) {
      if (
        session.finishedAt === null ||
        session.finishedAt > +today ||
        session.finishedAt < +monday ||
        session.finishedAt >= +result[6].end
      ) {
        continue;
      }

      const day = (new Date(session.finishedAt).getDay() + 6) % 7;
      result[day].count++;
    }

    return result;
  })();

  return (
    <Column verticalArrangement={{ spacedBy: 12 }}>
      <Row modifiers={[fillMaxWidth()]} horizontalArrangement="spaceBetween">
        <Text style={{ typography: "titleMedium", fontWeight: "600" }}>This week</Text>
        <Caption>{days.reduce((sum, day) => sum + day.count, 0)} / 3 workouts</Caption>
      </Row>
      <Row modifiers={[fillMaxWidth()]} horizontalArrangement={{ spacedBy: 6 }}>
        {days.map(({ date, count }, i) => {
          const isToday = date.toDateString() === today.toDateString();

          return (
            <Column
              key={i}
              modifiers={[
                weight(1),
                roundedClip(12),
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
