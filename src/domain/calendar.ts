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
