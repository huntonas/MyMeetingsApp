import type { MeetingSummary } from "@mymeetingapp/shared";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

import { nextOnPhoneClock } from "@/meetings/schedule";
import type { MeetingTypeCode } from "@/meetings/type-labels";
import { useNow } from "@/time/use-now";

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
// of the day it is now plus every later one (in the small hours, Night alone: it's the day's last part, still running).
function startingFilters(now: Date): MeetingFilters {
  const time = phoneTime(now);
  const current = TIME_ORDER.findIndex((name) => inTime(time, TIMES_OF_DAY[name]));
  return { ...NO_FILTERS, days: [now.getDay()], times: TIME_ORDER.slice(current) };
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
// the pills: every meeting whose upcomingStart (one that began under an hour ago still counts) comes before the day
// ends, when Night does at 5 AM, and that matches the chosen types and tags (owner decisions D1 and D2). So at 11 PM
// Monday, Tuesday's 12:00 AM meeting is listed, and at 10 PM this morning's 12:30 AM one isn't.
export function filtering(chosen: Chosen, now: Date) {
  const filters = { ...startingFilters(now), ...chosen };
  const starting = chosen.days === undefined && chosen.times === undefined;
  const dayEnds = nextOnPhoneClock(TIMES_OF_DAY.night.to, now).getTime();
  const keeps = (meeting: MeetingSummary, upcoming: Date) =>
    starting
      ? matchesFilters(meeting, { ...filters, days: [], times: [] }) && upcoming.getTime() < dayEnds
      : matchesFilters(meeting, filters);
  return { filters, keeps };
}

// filtering() for the person's choices so far. setFilters changes only the groups it's given: Clear filters gives all
// four, empty.
export function useFilters() {
  const { chosen, choose } = useContext(Filters);
  const now = useNow();
  return useMemo(() => ({ ...filtering(chosen, now), setFilters: choose }), [chosen, choose, now]);
}

export function anyFilterChosen({ days, times, types, tags }: MeetingFilters): boolean {
  return days.length + times.length + types.length + tags.length > 0;
}
