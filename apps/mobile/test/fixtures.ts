import { MeetingSummary, STARTER_VOCABULARY, type VocabularyResponse } from "@mymeetingapp/shared";

// Every fixture is parsed through its shared contract, so a fixture can't drift from what the server sends.
const BASE = MeetingSummary.parse({
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

export function meeting(change: Partial<MeetingSummary> = {}): MeetingSummary {
  return MeetingSummary.parse({ ...BASE, ...change });
}

export const VOCABULARY: VocabularyResponse = { tags: [...STARTER_VOCABULARY] };
