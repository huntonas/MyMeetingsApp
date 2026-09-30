// A calendar date with no time or zone: a meeting's day in its own zone, or a sobriety date on the phone.
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

// The app is US English; written by hand so the text doesn't depend on the phone's ICU version.
export const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export const DAY_MS = 86_400_000;
const utcDay = (date: CivilDate) => Date.UTC(date.year, date.month - 1, date.day);

// Days and day counts are taken on UTC's calendar, which has no daylight saving, so every day is exactly one day long
// and two dates are always a whole number of days apart.
export function daysBetween(from: CivilDate, to: CivilDate): number {
  return (utcDay(to) - utcDay(from)) / DAY_MS;
}

export function shiftDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

// The phone's own calendar date at an instant, in its current time zone.
export function civilDateOf(instant: Date): CivilDate {
  return { year: instant.getFullYear(), month: instant.getMonth() + 1, day: instant.getDate() };
}

// "Oct 5, 2027".
export function dateLabel(date: CivilDate): string {
  return `${MONTHS_SHORT[date.month - 1] ?? ""} ${String(date.day)}, ${String(date.year)}`;
}
