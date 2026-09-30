import { MeetingSearchResponse } from "@mymeetingapp/shared";

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

// Only the rounded point and the radius leave the phone, in the POST body; the cache key uses the same rounded values.
export function searchRead(origin: SearchOrigin): CachedRead<typeof MeetingSearchResponse> {
  const rounded = roundForSearch(origin.point);
  const request = { lat: rounded.latitude, lng: rounded.longitude, radiusKm: origin.radiusKm };
  return {
    kind: "search",
    key: `search:${String(request.lat)},${String(request.lng)},${String(request.radiusKm)}`,
    schema: MeetingSearchResponse,
    fetch: () => searchMeetings(request),
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
