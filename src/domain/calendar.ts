import type { Session } from "./workout";

/** The next moment a calendar summary can change without a new saved state. */
export function nextCalendarRefreshAt(history: Session[], now: Date) {
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  let next = +tomorrow;
  for (const session of history) {
    if (session.finishedAt !== null && session.finishedAt > +now)
      next = Math.min(next, session.finishedAt);
  }
  return next;
}

/** Local Monday midnight, using calendar arithmetic across DST. */
export function mondayWeekStart(now: Date) {
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}
