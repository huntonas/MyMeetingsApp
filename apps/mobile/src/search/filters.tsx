import type { MeetingSummary } from "@mymeetingapp/shared";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

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

const Filters = createContext<{ filters: MeetingFilters; setFilters: (next: MeetingFilters) => void }>({
  filters: NO_FILTERS,
  setFilters: () => undefined,
});

// Held in memory only; filters are never saved (decision 9).
export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const value = useMemo(() => ({ filters, setFilters }), [filters]);
  return <Filters.Provider value={value}>{children}</Filters.Provider>;
}

export function useFilters() {
  return useContext(Filters);
}
