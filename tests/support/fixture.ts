import {
  initialState,
  startSession,
  type Session,
} from "../../src/domain/workout";

export const NOW = 1792650000000;
export function finishedHistory(count = 10_000, now = NOW): Session[] {
  const state = initialState("kg");
  return Array.from({ length: count }, (_, i) => {
    const finishedAt = now - (i + 1) * 60_000;
    const session = startSession(
      state,
      finishedAt - 30_000,
      i % 2 ? "B" : "A",
    ).active!;
    return {
      ...session,
      id: `performance-${i}`,
      finishedAt,
      exercises: session.exercises.map((exercise) => ({
        ...exercise,
        weight: 20 + (i % 100) * 2.5,
        sets: exercise.sets.map((_, index) =>
          index === 4 && i % 3 === 0 ? 3 : 5,
        ),
      })),
    };
  });
}
