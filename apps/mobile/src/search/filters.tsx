import type { MeetingSummary } from "@mymeetingapp/shared";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

import { tomorrowOnPhoneClock } from "@/meetings/schedule";
import type { MeetingTypeCode } from "@/meetings/type-labels";

// On the meeting's listed time. Night runs past midnight.
export const TIMES_OF_DAY = {
  morning: { label: "Morning", from: "05:00", to: "12:00" },
  afternoon: { label: "Afternoon", from: "12:00", to: "17:00" },
  evening: { label: "Evening", from: "17:00", to: "21:00" },
  night: { label: "Night", from: "21:00", to: "05:00" },
} as const;
export type TimeOfDay = keyof typeof TIMES_OF_DAY;
export const TIME_ORDER: readonly TimeOfDay[] = ["morning", "afternoon", "evening", "night"];

export interface MeetingFilters {
  days: readonly number[];
  times: readonly TimeOfDay[];
  types: readonly MeetingTypeCode[];
  tags: readonly string[];
}

export const NO_FILTERS: MeetingFilters = { days: [], times: [], types: [], tags: [] };

function inTime(time: string, { from, to }: { from: string; to: string }): boolean {
  return from < to ? time >= from && time < to : time >= from || time < to;
}

// Spec §7: filtering by day, time, type and tag happens on the phone. Days and times match any chosen; types and tags
// must all be present.
function matchesFilters(meeting: MeetingSummary, filters: MeetingFilters): boolean {
  return (
    (filters.days.length === 0 || filters.days.includes(meeting.day)) &&
    (filters.times.length === 0 || filters.times.some((time) => inTime(meeting.time, TIMES_OF_DAY[time]))) &&
    filters.types.every((type) => meeting.types.includes(type)) &&
    filters.tags.every((slug) => meeting.tags.some((tag) => tag.slug === slug))
  );
}

export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

// The phone's clock as a listed time reads, "HH:MM".
function phoneTime(now: Date): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

// Owner decisions, 2026-09-30: the filters start as today, from now on. They read as the phone's weekday, and the part
// of the day it is now plus every later one. Night runs past midnight, so in its early hours the whole day is still
// ahead.
function startingFilters(now: Date): MeetingFilters {
  const time = phoneTime(now);
  const times = TIME_ORDER.filter(
    (name) => inTime(time, TIMES_OF_DAY[name]) || TIMES_OF_DAY[name].from > time,
  );
  return { ...NO_FILTERS, days: [now.getDay()], times };
}

// The groups the person has changed, each replacing its starting value; a group they haven't changed is absent.
type Chosen = Partial<MeetingFilters>;

const Filters = createContext<{ chosen: Chosen; choose: (groups: Chosen) => void }>({
  chosen: {},
  choose: () => undefined,
});

// Held in memory only; filters are never saved (decision 9).
export function FiltersProvider({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState<Chosen>({});
  const value = useMemo(
    () => ({
      chosen,
      choose: (groups: Chosen) => {
        setChosen((before) => ({ ...before, ...groups }));
      },
    }),
    [chosen],
  );
  return <Filters.Provider value={value}>{children}</Filters.Provider>;
}

// The filters at `now`, given the groups the person has changed, and whether a meeting is listed. Each group they
// haven't changed reads as its starting value for this moment, so it follows the clock (a new day, a later part of the
// day). While neither Day nor Time has been changed, what's listed is today, from now on, by the clock rather than by
// the pills: every meeting whose upcomingStart (one that began under an hour ago still counts) comes before 5 AM, when
// Night ends, on the day after the phone's date, and that matches the chosen types and tags (owner decisions D1 and
// D2). So at 11 PM Monday, Tuesday's 12:00 AM meeting is listed; at 3 AM Tuesday, all of Tuesday is; and at 10 PM
// this morning's 12:30 AM meeting isn't.
export function filtering(chosen: Chosen, now: Date) {
  const filters = { ...startingFilters(now), ...chosen };
  const starting = chosen.days === undefined && chosen.times === undefined;
  const dayEnds = tomorrowOnPhoneClock(TIMES_OF_DAY.night.to, now).getTime();
  const keeps = (meeting: MeetingSummary, upcoming: Date) =>
    starting
      ? matchesFilters(meeting, { ...filters, days: [], times: [] }) && upcoming.getTime() < dayEnds
      : matchesFilters(meeting, filters);
  // Nothing chosen at all: the starting filters as they are.
  const untouched = starting && filters.types.length === 0 && filters.tags.length === 0;
  return { filters, starting, untouched, keeps };
}

// The person's choices so far, for filtering() with the screen's own clock. setFilters changes only the groups it's
// given: Clear filters gives all four, empty.
export function useFilters() {
  const { chosen, choose } = useContext(Filters);
  return { chosen, setFilters: choose };
}

// The groups with something chosen. The starting Day and Time count: they read as chosen pills.
export function chosenGroups({ days, times, types, tags }: MeetingFilters): number {
  return [days, times, types, tags].filter((group) => group.length > 0).length;
}
