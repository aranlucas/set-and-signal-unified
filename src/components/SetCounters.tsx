import {
  Column,
  FilledTonalButton,
  FlowRow,
  Text,
  useMaterialColors,
} from "@expo/ui/jetpack-compose";
import { size, semantics } from "@expo/ui/jetpack-compose/modifiers";
import { NAMES, type Exercise } from "../domain/workout";

export function SetCounters({
  exercise: e,
  onPress,
}: {
  exercise: Exercise;
  onPress?: (index: number) => void;
}) {
  const c = useMaterialColors();
  const next = e.sets.findIndex((r) => r === null);
  return (
    <FlowRow
      horizontalArrangement={{ spacedBy: 8 }}
      verticalArrangement={{ spacedBy: 8 }}
    >
      {e.sets.map((reps, i) => (
        <Column
          key={i}
          horizontalAlignment="center"
          verticalArrangement={{ spacedBy: 4 }}
        >
          <Text
            color={i === next && onPress ? c.primary : c.onSurfaceVariant}
            style={{ typography: "labelSmall" }}
          >
            SET {i + 1}
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
                    : i === next && onPress
                      ? c.secondaryContainer
                      : c.surfaceContainerHighest,
              contentColor:
                reps === 5
                  ? c.onPrimary
                  : reps !== null
                    ? c.onErrorContainer
                    : c.onSurface,
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
              size(48, 48),
              semantics({
                contentDescription: `${NAMES[e.lift]}, set ${i + 1} of ${e.sets.length}, ${reps === null ? (onPress ? "not logged. Tap to log 5 reps" : "skipped") : `${reps} of 5 reps${onPress ? ". Tap to edit reps" : ""}`}`,
              }),
            ]}
          >
            <Text
              style={{
                typography:
                  reps !== null && reps < 5 ? "titleMedium" : "titleLarge",
                fontWeight: "600",
              }}
            >
              {reps === null
                ? onPress
                  ? "+"
                  : "–"
                : reps < 5
                  ? `${reps}/5`
                  : "5"}
            </Text>
          </FilledTonalButton>
        </Column>
      ))}
    </FlowRow>
  );
}
