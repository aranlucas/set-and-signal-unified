import { useState } from "react";
import {
  Column,
  Row,
  ModalBottomSheet,
  Text,
  TextButton,
  FlowRow,
  FilledTonalButton,
} from "@expo/ui/jetpack-compose";
import {
  fillMaxWidth,
  paddingAll,
  verticalScroll,
} from "@expo/ui/jetpack-compose/modifiers";
import { Action, Caption, Field, Heading } from "./ui";
import {
  CUES,
  NAMES,
  formatWeight,
  maxWeight,
  maxBarWeight,
  plateLoad,
  warmups,
  type AppState,
  type Lift,
} from "../domain/workout";

export function WeightSheet({
  state,
  lift,
  onDismiss,
  onSave,
}: {
  state: AppState;
  lift: Lift | "bar";
  onDismiss: () => void;
  onSave: (weight: number, increment?: number) => void;
}) {
  const plan = lift === "bar" ? null : state.plans[lift];
  const current =
    lift === "bar"
      ? state.settings.bar
      : (state.active?.exercises.find((e) => e.lift === lift)?.weight ??
        plan!.weight);
  const [value, setValue] = useState(String(current));
  const [increment, setIncrement] = useState(String(plan?.increment ?? 0));
  const [error, setError] = useState("");
  const save = () => {
    const number = Number(value.replace(",", "."));
    const inc = Number(increment.replace(",", "."));
    if (
      !value.trim() ||
      !Number.isFinite(number) ||
      number < (lift === "bar" ? 1 : 0) ||
      number >
        (lift === "bar"
          ? maxBarWeight(state.settings.unit)
          : maxWeight(state.settings.unit))
    ) {
      setError(
        lift === "bar"
          ? `Enter a bar weight from 1 to ${maxBarWeight(state.settings.unit)}.`
          : `Enter a weight from 0 to ${formatWeight(maxWeight(state.settings.unit))}.`,
      );
      return;
    }
    if (
      plan &&
      (!increment.trim() || !Number.isFinite(inc) || inc < 0.25 || inc > 50)
    ) {
      setError("Enter an increase from 0.25 to 50.");
      return;
    }
    onSave(number, plan ? inc : undefined);
  };
  return (
    <ModalBottomSheet onDismissRequest={onDismiss} skipPartiallyExpanded>
      <Column
        modifiers={[fillMaxWidth(), paddingAll(24), verticalScroll()]}
        verticalArrangement={{ spacedBy: 16 }}
      >
        <Heading>{lift === "bar" ? "Barbell weight" : NAMES[lift]}</Heading>
        <Field
          label={lift === "bar" ? "Bar weight" : "Total weight, including bar"}
          numeric
          value={value}
          onChange={(v) => {
            setValue(v);
            setError("");
          }}
          suffix={state.settings.unit}
        />
        {plan ? (
          <Row
            modifiers={[fillMaxWidth()]}
            horizontalArrangement={{ spacedBy: 8 }}
          >
            {[-1, 1].map((direction) => (
              <FilledTonalButton
                key={direction}
                onClick={() => {
                  const currentValue = Number(value.replace(",", "."));
                  if (!Number.isFinite(currentValue)) return;
                  setValue(
                    String(
                      Math.round(
                        Math.max(
                          0,
                          Math.min(
                            maxWeight(state.settings.unit),
                            currentValue + direction * plan.increment,
                          ),
                        ) * 1000,
                      ) / 1000,
                    ),
                  );
                  setError("");
                }}
              >
                <Text>
                  {direction < 0 ? "−" : "+"}
                  {formatWeight(plan.increment)} {state.settings.unit}
                </Text>
              </FilledTonalButton>
            ))}
          </Row>
        ) : null}
        {plan ? (
          <Field
            label="Increase after success"
            numeric
            value={increment}
            onChange={(v) => {
              setIncrement(v);
              setError("");
            }}
            suffix={state.settings.unit}
          />
        ) : null}
        {error ? <Text>{error}</Text> : null}
        <Caption>
          {state.active && lift !== "bar"
            ? "This updates the active workout and the next planned weight. Already logged sets use this exercise weight."
            : "This updates your next planned weight. Past workouts stay as logged."}
        </Caption>
        <Action onPress={save}>Save weight</Action>
        <TextButton onClick={onDismiss}>
          <Text>Cancel</Text>
        </TextButton>
      </Column>
    </ModalBottomSheet>
  );
}
export function ToolsSheet({
  state,
  lift,
  onDismiss,
}: {
  state: AppState;
  lift: Lift;
  onDismiss: () => void;
}) {
  const total =
    state.active?.exercises.find((e) => e.lift === lift)?.weight ??
    state.plans[lift].weight;
  const [selected, setSelected] = useState(total);
  const unit = state.settings.unit;
  const warmup = warmups(total, state.settings.bar, unit);
  const plates = plateLoad(selected, state.settings.bar, unit);
  return (
    <ModalBottomSheet onDismissRequest={onDismiss} skipPartiallyExpanded>
      <Column
        modifiers={[fillMaxWidth(), paddingAll(24), verticalScroll()]}
        verticalArrangement={{ spacedBy: 16 }}
      >
        <Heading>{NAMES[lift]} · Warm-up & plates</Heading>
        <Caption>{CUES[lift]}</Caption>
        <Text style={{ typography: "titleMedium" }}>Suggested warm-up</Text>
        {warmup.length ? (
          <Caption>
            {warmup
              .map(
                (w) =>
                  `${w.sets} × ${w.reps} at ${formatWeight(w.weight)} ${unit}`,
              )
              .join("\n")}
          </Caption>
        ) : (
          <Caption>
            Your work weight is at or below the bar weight. Start with a lighter
            training bar if you need one.
          </Caption>
        )}
        <Caption>
          Warm-ups are guidance and do not count toward your work sets. Tap a
          weight to see the plates.
        </Caption>
        <FlowRow
          horizontalArrangement={{ spacedBy: 8 }}
          verticalArrangement={{ spacedBy: 4 }}
        >
          {[...new Set([...warmup.map((w) => w.weight), total])].map((w) => (
            <FilledTonalButton key={w} onClick={() => setSelected(w)}>
              <Text>
                {formatWeight(w)} {unit}
                {w === total ? " · work" : ""}
              </Text>
            </FilledTonalButton>
          ))}
        </FlowRow>
        <Heading>
          {formatWeight(selected)} {unit} total
        </Heading>
        <Caption>
          Bar: {formatWeight(state.settings.bar)} {unit} · Plates on EACH side
        </Caption>
        {plates.belowBar ? (
          <Text>
            This target is lighter than your bar. Use a lighter bar or adjust
            the weight.
          </Text>
        ) : plates.perSide.length ? (
          plates.perSide.map((p) => (
            <Text key={p.weight} style={{ typography: "titleLarge" }}>
              {p.count} × {formatWeight(p.weight)} {unit}
            </Text>
          ))
        ) : (
          <Text>No plates · empty bar</Text>
        )}
        {plates.remainder > 0 ? (
          <Text>
            {formatWeight(plates.remainder)} {unit} cannot be loaded with these
            plates. The combination above is{" "}
            {formatWeight(selected - plates.remainder)} {unit}. Your logged
            weight has not changed.
          </Text>
        ) : null}
        <Caption>
          Assumes standard plates with enough pairs available:{" "}
          {unit === "kg"
            ? "25, 20, 15, 10, 5, 2.5, 1.25 kg"
            : "45, 35, 25, 10, 5, 2.5 lb"}
          . Check the plates available in your gym.
        </Caption>
        <Action onPress={onDismiss}>Back to workout</Action>
      </Column>
    </ModalBottomSheet>
  );
}
