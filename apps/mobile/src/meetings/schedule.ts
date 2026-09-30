import type { MeetingSummary } from "@mymeetingapp/shared";

import { clockLabel } from "@/time/clock";

export type Scheduled = Pick<MeetingSummary, "day" | "time" | "endTime"> & { timezone: string };
interface CivilDate {
  year: number;
  month: number;
  day: number;
}
export interface Occurrence {
  date: CivilDate;
  start: Date;
}

// A meeting with no end time counts as an hour long.
const DEFAULT_MINUTES = 60;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const formats = new Map<string, Intl.DateTimeFormat>();

function localParts(instant: Date, timeZone: string) {
  let format = formats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formats.set(timeZone, format);
  }
  const parts = format.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

// How far the zone's wall clock is ahead of UTC at an instant, in milliseconds.
function offsetAt(instant: number, timeZone: string): number {
  const l = localParts(new Date(instant), timeZone);
  return Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second) - instant;
}

const hourOf = (time: string) => Number(time.slice(0, 2));
const minuteOf = (time: string) => Number(time.slice(3, 5));

// The instant a local date and time happen in a zone. The offsets a day either side are the only two that can apply
// (no zone changes its clocks twice in two days). A wall time that happens twice (fall back) takes the earlier
// instant; one the clocks skip (spring forward) keeps the offset from before the change, so it lands an hour later,
// as Postgres does. Both hold whichever side of Greenwich the zone is on.
function zonedInstant(date: CivilDate, time: string, timeZone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hourOf(time), minuteOf(time));
  const before = wall - offsetAt(wall - DAY, timeZone);
  const after = wall - offsetAt(wall + DAY, timeZone);
  const valid = [before, after].filter((instant) => instant + offsetAt(instant, timeZone) === wall);
  return new Date(valid.length === 0 ? before : Math.min(...valid));
}

function shiftDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

const weekdayOf = (date: CivilDate) => new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();

// The latest start at or before `now`, on the meeting's weekday in its own zone.
export function lastOccurrence(meeting: Scheduled, now: Date): Occurrence {
  const local = localParts(now, meeting.timezone);
  const today = { year: local.year, month: local.month, day: local.day };
  const date = shiftDays(today, -((weekdayOf(today) - meeting.day + 7) % 7));
  const start = zonedInstant(date, meeting.time, meeting.timezone);
  if (start.getTime() <= now.getTime()) return { date, start };
  const weekEarlier = shiftDays(date, -7);
  return { date: weekEarlier, start: zonedInstant(weekEarlier, meeting.time, meeting.timezone) };
}

export function nextStart(meeting: Scheduled, now: Date): Date {
  return zonedInstant(shiftDays(lastOccurrence(meeting, now).date, 7), meeting.time, meeting.timezone);
}

// An end time at or before the start time is on the next day (11:30 PM to 12:30 AM).
export function occurrenceEnd(meeting: Scheduled, occurrence: Occurrence): Date {
  if (meeting.endTime === null) return new Date(occurrence.start.getTime() + DEFAULT_MINUTES * MINUTE);
  const date = meeting.endTime > meeting.time ? occurrence.date : shiftDays(occurrence.date, 1);
  return zonedInstant(date, meeting.endTime, meeting.timezone);
}

// A listed "HH:MM" as people read it.
export function listedTime(time: string): string {
  return clockLabel(hourOf(time), minuteOf(time));
}
