import { mondayWeekStart } from "./calendar";
import {
  convertWeight,
  LIFTS,
  type Lift,
  type Session,
  type Unit,
} from "./workout";

export interface LiftEntry {
  id: string;
  date: number;
  weight: number;
  sets: (number | null)[];
  success: boolean;
}

export type ProgressOverview = Record<
  Lift,
  {
    entries: LiftEntry[];
    best: number | null;
    latest: LiftEntry | null;
    total: number;
  }
>;

const overviewCache = new WeakMap<
  Session[],
  Partial<Record<Unit, ProgressOverview>>
>();

/**
 * Summarize every lift in one pass, retaining its ten most recent entries.
 * History and the returned overview (including nested arrays) are immutable by
 * convention. Replace the history array when editing it to invalidate the cache.
 */
export function getProgressOverview(
  history: Session[],
  unit: Unit,
): ProgressOverview {
  const cached = overviewCache.get(history);
  if (cached?.[unit]) return cached[unit];

  const overview = Object.fromEntries<ProgressOverview[Lift]>(
    LIFTS.map((lift) => [
      lift,
      { entries: [], best: null, latest: null, total: 0 },
    ]),
  ) as ProgressOverview;

  for (const session of history) {
    const date = session.finishedAt ?? session.startedAt;
    for (const exercise of session.exercises) {
      const record = overview[exercise.lift];
      const weight = convertWeight(exercise.weight, session.unit, unit);
      const success = exercise.sets.every((reps) => reps === 5);
      record.total++;
      if (success && (record.best === null || weight > record.best))
        record.best = weight;

      const entries = record.entries;
      if (entries.length === 10) {
        if (date < entries[0].date) continue;
        entries.shift();
      }
      // Insert after equal dates to preserve the legacy stable chronological order.
      let index = entries.length;
      while (index > 0 && entries[index - 1].date > date) index--;
      entries.splice(index, 0, {
        id: session.id,
        date,
        weight,
        sets: exercise.sets,
        success,
      });
      record.latest = entries[entries.length - 1];
    }
  }

  overviewCache.set(history, { ...cached, [unit]: overview });
  return overview;
}

/** Current Monday-based local week and three prior weeks, oldest first. */
export function trainingWeeks(
  history: Session[],
  now = new Date(),
): { start: number; count: number }[] {
  const monday = mondayWeekStart(now);
  const weeks = [-3, -2, -1, 0].map((offset) => {
    const start = new Date(monday);
    // Calendar arithmetic keeps local midnight across daylight saving changes.
    start.setDate(start.getDate() + offset * 7);
    return { start: start.getTime(), count: 0 };
  });
  const nowTime = now.getTime();
  for (const session of history) {
    const finishedAt = session.finishedAt;
    if (finishedAt === null || finishedAt > nowTime) continue;
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (finishedAt >= weeks[i].start) {
        weeks[i].count++;
        break;
      }
    }
  }
  return weeks;
}
