import {
  AppConfigResponse,
  MeetingDetailResponse,
  MeetingSearchRequest,
  MeetingSearchResponse,
  OnlineMeetingsResponse,
  VocabularyResponse,
} from "@mymeetingapp/shared";

import { getJson, postJson } from "@/api/client";

// Spec §8: read at every launch, to gate Nearby and Online below the minimum supported version.
export const fetchConfig = () => getJson(AppConfigResponse, "/api/v1/config");

// /api/v2: its categories are open-ended, so a category added on the server can't stop this build reading the list.
export const fetchVocabulary = () => getJson(VocabularyResponse, "/api/v2/vocabulary");

// Spec §2: the point is rounded to 2 decimals before it leaves the phone, and travels only in this POST body. Parsing
// with the shared schema first means an unrounded point throws here instead of being sent.
export const searchMeetings = async (request: MeetingSearchRequest) =>
  postJson(MeetingSearchResponse, "/api/v2/meetings/search", MeetingSearchRequest.parse(request));

export const fetchOnlineMeetings = (day: number) =>
  getJson(OnlineMeetingsResponse, `/api/v2/meetings/online?day=${String(day)}`);

export const fetchMeeting = (id: string) =>
  getJson(MeetingDetailResponse, `/api/v2/meetings/${encodeURIComponent(id)}`);
