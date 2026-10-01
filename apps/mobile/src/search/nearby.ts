import { MeetingSearchResponse, type MeetingSummary } from "@mymeetingapp/shared";
import { z } from "zod";

import { searchMeetings } from "@/api/reads";
import type { CachedRead } from "@/cache/cached-read";
import { distanceKm, type LatLng, roundForSearch } from "@/location/geo";
import { upcomingStart } from "@/meetings/schedule";
import type { Section } from "@/search/filters";

export interface SearchOrigin {
  kind: "me" | "place" | "map";
  // What the list says it's near: "you", the typed place, or "this map area".
  label: string;
  // The exact point, which stays on the phone.
  point: LatLng;
  radiusKm: number;
}

export type NearbyMeeting = MeetingSearchResponse["meetings"][number] & { exactKm: number };

// A search's answer as the phone keeps it: with where it was made (the label, the rounded point, never the exact one,
// and the radius), so offline the last search can stand in for a search elsewhere and still say where it's from.
const SearchResult = MeetingSearchResponse.extend({
  origin: z.object({
    kind: z.enum(["me", "place", "map"]),
    label: z.string(),
    lat: z.number(),
    lng: z.number(),
    radiusKm: z.number(),
  }),
});
type SearchResult = z.output<typeof SearchResult>;

const searchKey = ({ lat, lng, radiusKm }: SearchResult["origin"]) =>
  `search:${String(lat)},${String(lng)},${String(radiusKm)}`;

function savedOrigin(origin: SearchOrigin): SearchResult["origin"] {
  const rounded = roundForSearch(origin.point);
  return {
    kind: origin.kind,
    label: origin.label,
    lat: rounded.latitude,
    lng: rounded.longitude,
    radiusKm: origin.radiusKm,
  };
}

// Only the rounded point and the radius leave the phone, in the POST body; the cache key uses the same rounded values.
export function searchRead(origin: SearchOrigin): CachedRead<typeof SearchResult> {
  const saved = savedOrigin(origin);
  const request = { lat: saved.lat, lng: saved.lng, radiusKm: saved.radiusKm };
  return {
    kind: "search",
    key: searchKey(saved),
    schema: SearchResult,
    fetch: async () => ({ ...(await searchMeetings(request)), origin: saved }),
  };
}

// "you" and "this map area" meant where the person was, or the map was, back then.
const PAST_LABELS: Partial<Record<SearchOrigin["kind"], string>> = {
  me: "your earlier location",
  map: "the map area you searched",
};

// What the list is near: the search asked for, or, when the answer is the last search standing in for it offline,
// where that one was made (its rounded point, so distances are measured from there).
export function describedOrigin(result: SearchResult, asked: SearchOrigin) {
  const { origin } = result;
  if (searchKey(origin) === searchKey(savedOrigin(asked)))
    return { label: asked.label, point: asked.point, radiusKm: asked.radiusKm, lastSearch: false };
  return {
    label: PAST_LABELS[origin.kind] ?? origin.label,
    point: { latitude: origin.lat, longitude: origin.lng },
    radiusKm: origin.radiusKm,
    lastSearch: true,
  };
}

// Soonest (the default) or nearest first: the person's choice, held in memory only.
export type NearbyOrder = "soonest" | "nearest";

// The Nearby list: each meeting in the section `section` gives it (filtering's rule, given when it comes up), each
// section in order. Spec §8: the server sorts by distance from the rounded point, which says nothing about time. The
// phone sorts by the exact distance from the real point, or by the next start (owner decision, 2026-09-30), each
// breaking the other's ties, so meetings at one place read in time order. Each meeting's upcomingStart is worked out
// once, for both.
export function listNearby(
  meetings: MeetingSearchResponse["meetings"],
  from: LatLng,
  order: NearbyOrder,
  now: Date,
  section: (meeting: MeetingSummary, upcoming: Date) => Section,
): Record<Exclude<Section, null>, NearbyMeeting[]> {
  const measured = meetings.flatMap((meeting) => {
    const upcoming = upcomingStart(meeting, now);
    const goes = section(meeting, upcoming);
    if (goes === null) return [];
    const exactKm =
      meeting.latitude === null || meeting.longitude === null
        ? meeting.distanceKm
        : distanceKm(from, { latitude: meeting.latitude, longitude: meeting.longitude });
    return [{ meeting: { ...meeting, exactKm }, startsAt: upcoming.getTime(), goes }];
  });
  type Measured = (typeof measured)[number];
  const byDistance = (a: Measured, b: Measured) => a.meeting.exactKm - b.meeting.exactKm;
  const byStart = (a: Measured, b: Measured) => a.startsAt - b.startsAt;
  const sorted = measured.sort((a, b) =>
    order === "soonest" ? byStart(a, b) || byDistance(a, b) : byDistance(a, b) || byStart(a, b),
  );
  const inSection = (goes: Exclude<Section, null>) =>
    sorted.filter((item) => item.goes === goes).map(({ meeting }) => meeting);
  return { listed: inSection("listed"), tomorrow: inSection("tomorrow") };
}
