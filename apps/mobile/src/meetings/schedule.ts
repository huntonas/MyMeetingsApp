import type { MeetingSummary } from "@mymeetingapp/shared";

import { type CivilDate, DAY_MS, MINUTE_MS, shiftDays } from "@/time/civil-date";
import { clockLabel, phoneClockLabel } from "@/time/clock";

export type Scheduled = Pick<MeetingSummary, "day" | "time" | "endTime"> & { timezone: string };
export interface Occurrence {
  date: CivilDate;
  start: Date;
}

// A meeting with no end time counts as an hour long.
const DEFAULT_MINUTES = 60;

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
    // Some ICU builds write midnight as hour 24 even with h23; it is the same instant as hour 0.
    hour: part("hour") % 24,
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

// The instant a local date and time happen in a zone, resolved as Postgres's AT TIME ZONE does on the server (owner
// ruling M-a). The offsets a day either side are the only two that can apply (no zone changes its clocks twice in two
// days). A wall time that happens twice (fall back) takes the later instant, under the offset after the change; one
// the clocks skip (spring forward) keeps the offset from before the change, so it lands later by the jump. Both hold
// whichever side of Greenwich the zone is on.
function zonedInstant(date: CivilDate, time: string, timeZone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hourOf(time), minuteOf(time));
  const after = wall - offsetAt(wall + DAY_MS, timeZone);
  if (after + offsetAt(after, timeZone) === wall) return new Date(after);
  return new Date(wall - offsetAt(wall - DAY_MS, timeZone));
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

// The start a week after `last` (from lastOccurrence).
export function nextStart(meeting: Scheduled, last: Occurrence): Date {
  return zonedInstant(shiftDays(last.date, 7), meeting.time, meeting.timezone);
}

// Someone may still walk in late: a meeting that began this long ago still counts as coming up.
const LATE_ARRIVAL_MINUTES = 60;

// The zone the phone's own clock is in.
const phoneZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// The start a list sorted by what's soonest goes by: the latest one for an hour after it begins, so a meeting that has
// just started stays at the top instead of dropping to next week, and the next one after that. A meeting the feed gave
// no zone is read on the phone's clock: nearby meetings are almost always in the phone's own zone.
export function upcomingStart(
  meeting: Pick<MeetingSummary, "day" | "time" | "endTime" | "timezone">,
  now: Date,
): Date {
  const scheduled = { ...meeting, timezone: meeting.timezone ?? phoneZone() };
  const last = lastOccurrence(scheduled, now);
  if (now.getTime() - last.start.getTime() <= LATE_ARRIVAL_MINUTES * MINUTE_MS) return last.start;
  return nextStart(scheduled, last);
}

const twoDigits = (value: number) => String(value).padStart(2, "0");

// The time the phone's clock shows at `now`, written as a listed time is ("HH:MM"), so the two compare as strings.
export function phoneClockTime(now: Date): string {
  const local = localParts(now, phoneZone());
  return `${twoDigits(local.hour)}:${twoDigits(local.minute)}`;
}

// The instant the phone's clock reads `time` ("05:00") on the day after its date at `now`: at 3 AM Tuesday, as at 6 PM
// Monday's 6 PM is Tuesday's, it's Wednesday's.
export function tomorrowOnPhoneClock(time: string, now: Date): Date {
  const zone = phoneZone();
  const local = localParts(now, zone);
  return zonedInstant(shiftDays({ year: local.year, month: local.month, day: local.day }, 1), time, zone);
}

// An end time earlier than the start time is on the next day (11:30 PM to 12:30 AM). One equal to the start says
// nothing about the length, so it counts as missing (owner ruling M-f).
export function occurrenceEnd(meeting: Scheduled, occurrence: Occurrence): Date {
  const { endTime, time, timezone } = meeting;
  if (endTime !== null && endTime > time) return zonedInstant(occurrence.date, endTime, timezone);
  if (endTime !== null && endTime < time)
    return zonedInstant(shiftDays(occurrence.date, 1), endTime, timezone);
  return new Date(occurrence.start.getTime() + DEFAULT_MINUTES * MINUTE_MS);
}

// A listed "HH:MM" as people read it.
export function listedTime(time: string): string {
  return clockLabel(hourOf(time), minuteOf(time));
}

// A meeting's own weekday, as listed; Sunday first, as MeetingSummary.day counts.
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// "Mon 7:00 PM": the listed day and time on a card in any meeting list.
export function shortWhen(meeting: Pick<MeetingSummary, "day" | "time">): string {
  return `${WEEKDAYS_SHORT[meeting.day] ?? ""} ${listedTime(meeting.time)}`;
}

// For a meeting in another zone: when its next start is on the phone's clock, or null when the phone would show the
// same day and time as the listing.
export function yourTime(meeting: Scheduled, now: Date): string | null {
  const start = nextStart(meeting, lastOccurrence(meeting, now));
  const onPhone = `${WEEKDAYS[start.getDay()] ?? ""} at ${phoneClockLabel(start)}`;
  if (onPhone === `${WEEKDAYS[meeting.day] ?? ""} at ${listedTime(meeting.time)}`) return null;
  return `That's ${onPhone} your time.`;
}

// A zone as people name it, for "(Eastern Time)" after a listed time: Intl's generic name, which unlike its standard
// and daylight names doesn't change with the date. Hermes supports "longGeneric" on iOS and Android. When the engine
// has no name for the zone, only an offset ("GMT+00:00") or nothing, the city in its IANA name stands in ("UTC time").
export function zoneName(timezone: string): string {
  const generic = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longGeneric" })
    .formatToParts()
    .find((part) => part.type === "timeZoneName")?.value;
  if (generic !== undefined && !/^(GMT|UTC)/.test(generic)) return generic;
  return `${(timezone.split("/").at(-1) ?? timezone).replace(/_/g, " ")} time`;
}
