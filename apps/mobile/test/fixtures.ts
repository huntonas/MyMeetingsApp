import {
  AppConfigResponse,
  V1MeetingSearchResponse,
  V1MeetingSummary,
  STARTER_VOCABULARY,
  type VocabularyResponse,
} from "@mymeetingapp/shared";

// Every fixture is parsed through its shared contract, so a fixture can't drift from what the server sends.
const BASE = V1MeetingSummary.parse({
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  name: "Nooners",
  day: 1,
  time: "12:00",
  endTime: "13:00",
  timezone: "America/Chicago",
  types: ["O", "B"],
  attendance: "in_person",
  locationName: "St. Luke's",
  formattedAddress: "1 Main St, Nashville, TN 37203, USA",
  latitude: 36.1627,
  longitude: -86.7816,
  locationNotes: null,
  notes: null,
  groupName: null,
  conferenceUrl: null,
  conferenceUrlNotes: null,
  conferencePhone: null,
  conferencePhoneNotes: null,
  sourceUrl: "https://aanashville.org/meetings/nooners",
  tagsDisabled: false,
  tags: [{ slug: "welcoming", count: 14 }],
});

export function meeting(change: Partial<V1MeetingSummary> = {}): V1MeetingSummary {
  return V1MeetingSummary.parse({ ...BASE, ...change });
}

type SearchMeeting = V1MeetingSearchResponse["meetings"][number];

// A search result: a meeting plus its distance from the rounded point the server was sent.
export function nearbyMeeting(change: Partial<SearchMeeting> = {}): SearchMeeting {
  const parsed = V1MeetingSearchResponse.parse({ meetings: [{ ...BASE, distanceKm: 1.2, ...change }] })
    .meetings[0];
  if (parsed === undefined) throw new Error("unreachable: one meeting in, one out");
  return parsed;
}

export const VOCABULARY: VocabularyResponse = { tags: [...STARTER_VOCABULARY] };

// Matches app.config.ts's version (0.1.0) and the default fake nativeApplicationVersion, so a current install isn't
// gated unless a test raises minSupportedVersion above it.
export const CONFIG: AppConfigResponse = AppConfigResponse.parse({
  minSupportedVersion: { ios: "0.1.0", android: "0.1.0" },
  latestVersion: { ios: "0.1.0", android: "0.1.0" },
  features: { tagging: true, suggestions: true },
});
