import type { Session } from "./workout";
let numbers: Intl.NumberFormat | undefined;
let sessionDates: Intl.DateTimeFormat | undefined;
let workoutDates: Intl.DateTimeFormat | undefined;
let weekDates: Intl.DateTimeFormat | undefined;
let chartDates: Intl.DateTimeFormat | undefined;
let shortDates: Intl.DateTimeFormat | undefined;
let dates: Intl.DateTimeFormat | undefined;
let clocks: Intl.DateTimeFormat | undefined;

export const formatWeight = (n: number) =>
  (numbers ??= new Intl.NumberFormat()).format(Number(n.toFixed(2)));
export const sessionDate = (session: Session) =>
  (sessionDates ??= new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })).format(session.finishedAt ?? session.startedAt);
export const workoutDate = (at: number) =>
  (workoutDates ??= new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  })).format(at);
export const weekDate = (at: number) =>
  (weekDates ??= new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  })).format(at);
export const chartDate = (at: number) =>
  (chartDates ??= new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
  })).format(at);
export const shortDate = (at: number) =>
  (shortDates ??= new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })).format(at);
export const date = (at: number) =>
  (dates ??= new Intl.DateTimeFormat()).format(at);
export const clock = (at: number) =>
  (clocks ??= new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })).format(at);
