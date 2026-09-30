import { MeetingSearchResponse } from "@mymeetingapp/shared";
import { z } from "zod";

import { searchMeetings } from "@/api/reads";
import type { CachedRead } from "@/cache/cached-read";
import { distanceKm, type LatLng, roundForSearch } from "@/location/geo";

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

// Spec §8: the server sorts by distance from the rounded point; the phone re-sorts by the exact distance.
export function byExactDistance(meetings: MeetingSearchResponse["meetings"], from: LatLng): NearbyMeeting[] {
  return meetings
    .map((meeting) => ({
      ...meeting,
      exactKm:
        meeting.latitude === null || meeting.longitude === null
          ? meeting.distanceKm
          : distanceKm(from, { latitude: meeting.latitude, longitude: meeting.longitude }),
    }))
    .sort((a, b) => a.exactKm - b.exactKm);
}
