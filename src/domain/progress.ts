import { convertWeight, type AppState, type Lift, type Unit } from "./workout";

export function liftEntries(
  state: AppState,
  lift: Lift,
  unit: Unit = state.settings.unit,
) {
  return state.history
    .flatMap((s) =>
      s.exercises
        .filter((e) => e.lift === lift)
        .map((e) => ({
          id: s.id,
          date: s.finishedAt ?? s.startedAt,
          weight: convertWeight(e.weight, s.unit, unit),
          sets: e.sets,
          success: e.sets.every((r) => r === 5),
        })),
    )
    .sort((a, b) => a.date - b.date);
}
export function liftRecord(state: AppState, lift: Lift) {
  const entries = liftEntries(state, lift);
  const successes = entries.filter((e) => e.success);
  return {
    entries,
    best: successes.length ? Math.max(...successes.map((e) => e.weight)) : null,
    latest: entries.at(-1) ?? null,
  };
}
