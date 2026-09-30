import type { MeetingSummary } from "@mymeetingapp/shared";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

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
export function matchesFilters(meeting: MeetingSummary, filters: MeetingFilters): boolean {
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

// Owner decision, 2026-09-30: today's meetings from now on. The phone's weekday, and the part of the day it is now plus
// every later one. Night runs past midnight, so in its early hours the whole day is still ahead.
function startingFilters(now: Date): MeetingFilters {
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const times = TIME_ORDER.filter(
    (name) => inTime(time, TIMES_OF_DAY[name]) || TIMES_OF_DAY[name].from > time,
  );
  return { ...NO_FILTERS, days: [now.getDay()], times };
}

// The person's own choice, or null until they make one.
const Filters = createContext<{ chosen: MeetingFilters | null; setFilters: (next: MeetingFilters) => void }>({
  chosen: null,
  setFilters: () => undefined,
});

// Held in memory only; filters are never saved (decision 9).
export function FiltersProvider({ children }: { children: ReactNode }) {
  const [chosen, setFilters] = useState<MeetingFilters | null>(null);
  const value = useMemo(() => ({ chosen, setFilters }), [chosen]);
  return <Filters.Provider value={value}>{children}</Filters.Provider>;
}

// Until the person changes a filter, the filters are the starting ones for this moment, so they follow the clock (a new
// day, a later part of the day). Once they change one, Clear filters included, their choice stands while the app runs.
export function useFilters() {
  const { chosen, setFilters } = useContext(Filters);
  const now = useNow();
  const filters = useMemo(() => chosen ?? startingFilters(now), [chosen, now]);
  return { filters, setFilters };
}

export function anyFilterChosen({ days, times, types, tags }: MeetingFilters): boolean {
  return days.length + times.length + types.length + tags.length > 0;
}
