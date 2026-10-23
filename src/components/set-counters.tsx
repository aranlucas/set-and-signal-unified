import { Column, FilledTonalButton, Row, Text, useMaterialColors } from "@expo/ui/jetpack-compose";
import {
  defaultMinSize,
  fillMaxWidth,
  semantics,
  weight,
} from "@expo/ui/jetpack-compose/modifiers";
import { NAMES, type Exercise } from "../domain/workout";

interface SetCountersProps {
  exercise: Exercise;
  onPress?: (index: number) => void;
}

// Every exercise gets five equal columns, so a 1×5 deadlift lines up with the
// first column of each 5×5 lift and counters use the full card width.
const COLUMNS = 5;

export function SetCounters({ exercise: e, onPress }: SetCountersProps) {
  const c = useMaterialColors();
  const next = e.sets.findIndex((r) => r === null);

  return (
    <Row modifiers={[fillMaxWidth()]}>
      {Array.from({ length: COLUMNS }, (_, i) => {
        if (i >= e.sets.length) {
          return <Column key={i} modifiers={[weight(1)]} />;
        }

        const reps = e.sets[i];
        const isNext = i === next && !!onPress;

        return (
          <Column
            key={i}
            modifiers={[weight(1)]}
            horizontalAlignment="center"
            verticalArrangement={{ spacedBy: 4 }}
          >
            <Text
              color={isNext ? c.primary : c.onSurfaceVariant}
              style={{
                typography: "labelMedium",
                fontWeight: isNext ? "700" : "500",
              }}
              maxLines={1}
            >
              {i + 1}
            </Text>
            <FilledTonalButton
              onClick={() => onPress?.(i)}
              enabled={!!onPress}
              contentPadding={{ start: 0, end: 0, top: 0, bottom: 0 }}
              colors={{
                containerColor:
                  reps === 5
                    ? c.primary
                    : reps !== null
                      ? c.errorContainer
                      : isNext
                        ? c.secondaryContainer
                        : c.surfaceContainerHighest,
                contentColor:
                  reps === 5 ? c.onPrimary : reps !== null ? c.onErrorContainer : c.onSurface,
                disabledContainerColor:
                  reps === 5
                    ? c.primaryContainer
                    : reps !== null
                      ? c.errorContainer
                      : c.surfaceContainerHighest,
                disabledContentColor:
                  reps === 5
                    ? c.onPrimaryContainer
                    : reps !== null
                      ? c.onErrorContainer
                      : c.onSurfaceVariant,
              }}
              modifiers={[
                // A minimum rather than a fixed size lets "3/5" grow with font scaling.
                defaultMinSize({ minWidth: 56, minHeight: 56 }),
                semantics({
                  contentDescription: `${NAMES[e.lift]}, set ${i + 1} of ${e.sets.length}, ${reps === null ? (onPress ? "not logged. Tap to log 5 reps" : "skipped") : `${reps} of 5 reps${onPress ? ". Tap to edit reps" : ""}`}`,
                }),
              ]}
            >
              <Text
                style={{
                  typography: reps !== null && reps < 5 ? "titleMedium" : "titleLarge",
                  fontWeight: "600",
                }}
                maxLines={1}
              >
                {reps === null ? (onPress ? "+" : "–") : reps < 5 ? `${reps}/5` : "5"}
              </Text>
            </FilledTonalButton>
          </Column>
        );
      })}
    </Row>
  );
}
