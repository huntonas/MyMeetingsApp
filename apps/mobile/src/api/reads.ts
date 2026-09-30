import {
  MeetingDetailResponse,
  MeetingSearchRequest,
  MeetingSearchResponse,
  OnlineMeetingsResponse,
  VocabularyResponse,
} from "@mymeetingapp/shared";

import { getJson, postJson } from "@/api/client";

export const fetchVocabulary = () => getJson(VocabularyResponse, "/api/v1/vocabulary");

// Spec §2: the point is rounded to 2 decimals before it leaves the phone, and travels only in this POST body. Parsing
// with the shared schema first means an unrounded point throws here instead of being sent.
export const searchMeetings = async (request: MeetingSearchRequest) =>
  postJson(MeetingSearchResponse, "/api/v1/meetings/search", MeetingSearchRequest.parse(request));

export const fetchOnlineMeetings = (day: number) =>
  getJson(OnlineMeetingsResponse, `/api/v1/meetings/online?day=${String(day)}`);

export const fetchMeeting = (id: string) =>
  getJson(MeetingDetailResponse, `/api/v1/meetings/${encodeURIComponent(id)}`);
