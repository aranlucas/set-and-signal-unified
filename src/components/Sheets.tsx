import { loadPlates, type PlateOption } from "../domain/plates";
import { useAppState } from "../data/store";
import { useState } from "react";
import {
  Column,
  Row,
  ModalBottomSheet,
  Text,
  FlowRow,
  FilledTonalButton,
  FilterChip,
} from "@expo/ui/jetpack-compose";
import {
  fillMaxWidth,
  defaultMinSize,
  paddingAll,
  verticalScroll,
  weight,
} from "@expo/ui/jetpack-compose/modifiers";
import { Action, Caption, Field, Heading } from "./ui";
import {
  CUES,
  NAMES,
  formatWeight,
  maxWeight,
  maxBarWeight,
  warmups,
  type Lift,
} from "../domain/workout";

export function WeightSheet({
  lift,
  onDismiss,
  onSave,
}: {
  lift: Lift | "bar";
  onDismiss: () => void;
  onSave: (weight: number, increment?: number) => void;
}) {
  const state = {
    settings: useAppState((s) => s.settings),
    plans: useAppState((s) => s.plans),
    active: useAppState((s) => s.active?.exercises),
  };
  const plan = lift === "bar" ? null : state.plans[lift];
  const current =
    lift === "bar"
      ? state.settings.bar
      : (state.active?.find((e) => e.lift === lift)?.weight ?? plan!.weight);
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
                modifiers={[weight(1)]}
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
        <Action onPress={onDismiss} subtle>
          Cancel
        </Action>
      </Column>
    </ModalBottomSheet>
  );
}
export function ToolsSheet({
  lift,
  onDismiss,
}: {
  lift: Lift;
  onDismiss: () => void;
}) {
  const unit = useAppState((s) => s.active?.unit ?? s.settings.unit);
  const bar = useAppState((s) => s.settings.bar);
  const inventory = useAppState((s) => s.settings.plates);
  const total = useAppState(
    (s) =>
      s.active?.exercises.find((e) => e.lift === lift)?.weight ??
      s.plans[lift].weight,
  );
  const [selected, setSelected] = useState(total);
  const warmup = warmups(total, bar, unit);
  const plates = loadPlates(selected, bar, unit, inventory);
  const [alternative, setAlternative] = useState<PlateOption | null>(null);
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
            <FilledTonalButton
              key={w}
              onClick={() => {
                setSelected(w);
                setAlternative(null);
              }}
            >
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
          Bar: {formatWeight(bar)} {unit} · Plates on each side
        </Caption>
        {plates.belowBar ? (
          <Text>
            This target is lighter than your bar. Use a lighter bar or adjust
            the weight.
          </Text>
        ) : inventory !== null && !plates.exact ? (
          <>
            <Text>
              You can't load {formatWeight(selected)} {unit} with your plates.
            </Text>
            <FlowRow
              horizontalArrangement={{ spacedBy: 8 }}
              verticalArrangement={{ spacedBy: 8 }}
            >
              {(
                [
                  ["below", plates.below],
                  ["above", plates.above],
                ] as const
              ).map(([direction, option]) =>
                option ? (
                  <FilterChip
                    key={direction}
                    modifiers={[defaultMinSize({ minHeight: 48 })]}
                    selected={alternative?.loaded === option.loaded}
                    onClick={() => setAlternative(option)}
                  >
                    <FilterChip.Label>
                      <Text>
                        Closest {direction}: {formatWeight(option.loaded)}{" "}
                        {unit}
                      </Text>
                    </FilterChip.Label>
                  </FilterChip>
                ) : null,
              )}
            </FlowRow>
            {alternative ? (
              <Column verticalArrangement={{ spacedBy: 8 }}>
                <Text>
                  {formatWeight(alternative.loaded)} {unit} total · Plates on
                  each side
                </Text>
                {alternative.perSide.length ? (
                  alternative.perSide.map((p) => (
                    <Text key={p.weight}>
                      {p.count} × {formatWeight(p.weight)} {unit}
                    </Text>
                  ))
                ) : (
                  <Text>No plates · empty bar</Text>
                )}
              </Column>
            ) : null}
          </>
        ) : plates.perSide.length ? (
          plates.perSide.map((p) => (
            <Text key={p.weight} style={{ typography: "titleLarge" }}>
              {p.count} × {formatWeight(p.weight)} {unit}
            </Text>
          ))
        ) : (
          <Text>No plates · empty bar</Text>
        )}
        {inventory === null && plates.remainder > 0 ? (
          <Text>
            {formatWeight(plates.remainder)} {unit} cannot be loaded with these
            plates. The combination above is{" "}
            {formatWeight(selected - plates.remainder)} {unit}. Your logged
            weight has not changed.
          </Text>
        ) : null}
        <Caption>
          {inventory !== null
            ? "Using your plates."
            : `Assumes standard plates with enough pairs available: ${unit === "kg" ? "25, 20, 15, 10, 5, 2.5, 1.25 kg" : "45, 35, 25, 10, 5, 2.5 lb"}. Check the plates available in your gym.`}
        </Caption>
        <Action onPress={onDismiss}>Back to workout</Action>
      </Column>
    </ModalBottomSheet>
  );
}
