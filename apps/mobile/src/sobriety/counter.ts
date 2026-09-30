import { type CivilDate, shiftDays } from "@/time/civil-date";

export interface SoberTime {
  totalDays: number;
  years: number;
  months: number;
  days: number;
}

interface Milestone {
  label: string;
  date: CivilDate;
}

const DAY_MS = 86_400_000;

// Days since 1970 on UTC's calendar, which has no daylight saving, so two dates are always a whole number apart.
const dayNumber = (date: CivilDate) => Date.UTC(date.year, date.month - 1, date.day) / DAY_MS;
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

// "1 day", "5,650 days": digits grouped by hand, as the app does all its text, so ICU versions can't change it.
export const plural = (count: number, word: string) =>
  `${String(count).replace(/\B(?=(\d{3})+$)/g, ",")} ${word}${count === 1 ? "" : "s"}`;

// Whole months from `start`, keeping its day of the month, or the month's last day when that month is shorter: a month
// from Jan 31 is Feb 28 (or 29), and a leap-day start's anniversary is Feb 28 in other years.
function addMonths(start: CivilDate, months: number): CivilDate {
  const index = start.month - 1 + months;
  const year = start.year + Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, day: Math.min(start.day, daysInMonth(year, month)) };
}

// Spec §8: total days, plus years, months and days. Null for a start after today, which has nothing to count yet.
export function soberTime(start: CivilDate, today: CivilDate): SoberTime | null {
  const totalDays = dayNumber(today) - dayNumber(start);
  if (totalDays < 0) return null;
  let months = (today.year - start.year) * 12 + (today.month - start.month);
  if (dayNumber(addMonths(start, months)) > dayNumber(today)) months -= 1;
  return {
    totalDays,
    years: Math.floor(months / 12),
    months: months % 12,
    days: dayNumber(today) - dayNumber(addMonths(start, months)),
  };
}

// "1 year, 1 month, 16 days", leaving out the parts that are zero.
export function breakdownLabel(time: SoberTime): string {
  const parts: string[] = [];
  if (time.years > 0) parts.push(plural(time.years, "year"));
  if (time.months > 0) parts.push(plural(time.months, "month"));
  if (time.days > 0) parts.push(plural(time.days, "day"));
  return parts.join(", ");
}

// Spec §8: 24 hours, 30, 60 and 90 days, 6 and 9 months, 1 year, and each year after, up to `lastYear` years.
function milestonesUntil(start: CivilDate, lastYear: number): Milestone[] {
  const list = [
    { label: "24 hours", date: shiftDays(start, 1) },
    { label: "30 days", date: shiftDays(start, 30) },
    { label: "60 days", date: shiftDays(start, 60) },
    { label: "90 days", date: shiftDays(start, 90) },
    { label: "6 months", date: addMonths(start, 6) },
    { label: "9 months", date: addMonths(start, 9) },
  ];
  for (let year = 1; year <= lastYear; year++) {
    list.push({ label: plural(year, "year"), date: addMonths(start, 12 * year) });
  }
  return list;
}

// The milestone that falls on `today`, if any.
export function milestoneToday(start: CivilDate, today: CivilDate): string | null {
  const reached = milestonesUntil(start, today.year - start.year).find(
    (milestone) => dayNumber(milestone.date) === dayNumber(today),
  );
  return reached?.label ?? null;
}

// The first milestone after `today`. The list runs to next year's anniversary, so there always is one.
export function nextMilestone(start: CivilDate, today: CivilDate): Milestone {
  const next = milestonesUntil(start, today.year - start.year + 1).find(
    (milestone) => dayNumber(milestone.date) > dayNumber(today),
  );
  if (next === undefined) throw new Error("The milestone list always runs past today");
  return next;
}
