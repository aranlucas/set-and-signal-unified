import type { WorkoutSource } from "./records";

interface LinkedWorkout {
  id: string;
  source?: WorkoutSource;
  garminActivityIds?: string[];
}

/** Explicit source matching; calendar dates are never identities. */
export function reconcileGarminRecording<T extends LinkedWorkout>(
  workouts: T[],
  record: T,
  matchId?: string,
): T[] {
  if (record.source?.provider !== "garmin") throw new Error("Expected a recorded Garmin workout");
  const activityId = record.source.id;

  if (matchId) {
    const match = workouts.find((workout) => workout.id === matchId);

    if (!match) throw new Error("The selected phone workout no longer exists");

    return workouts.flatMap((workout): T[] => {
      if (
        workout.id !== matchId &&
        workout.source?.provider === "garmin" &&
        workout.source.id === activityId
      ) {
        return [];
      }

      if (workout.id === matchId) {
        return [
          {
            ...workout,
            garminActivityIds: [...new Set([...(workout.garminActivityIds ?? []), activityId])],
          },
        ];
      }

      if (workout.garminActivityIds?.includes(activityId)) {
        return [
          {
            ...workout,
            garminActivityIds: workout.garminActivityIds.filter((id) => id !== activityId),
          },
        ];
      }

      return [workout];
    });
  }

  if (
    workouts.some(
      (workout) =>
        (workout.source?.provider === "garmin" && workout.source.id === activityId) ||
        workout.garminActivityIds?.includes(activityId),
    )
  )
    return workouts;

  return [...workouts, record];
}

export function unlinkGarminRecording<T extends LinkedWorkout>(
  workouts: T[],
  workoutId: string,
  activityId: string,
): T[] {
  return workouts.map((workout) =>
    workout.id === workoutId
      ? {
          ...workout,
          garminActivityIds: workout.garminActivityIds?.filter((id) => id !== activityId),
        }
      : workout,
  );
}
