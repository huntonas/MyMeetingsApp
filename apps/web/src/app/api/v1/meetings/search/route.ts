import { isV1MeetingType, MeetingSearchRequest, V1MeetingSearchResponse } from "@mymeetingapp/shared";

import { readJsonBody } from "@/lib/api/request";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { searchMeetings } from "@/server/meetings/search";

export const dynamic = "force-dynamic";

// Spec §2: coordinates arrive rounded, only in this POST body, and are never stored, logged or cached.
export const POST = withErrors(async (req: Request) => {
  const request = await readJsonBody(req, MeetingSearchRequest);
  // For builds before 1.1 (V1MeetingSummary).
  const meetings = (await searchMeetings(request, "aa")).map((meeting) => ({
    ...meeting,
    types: meeting.types.filter(isV1MeetingType),
  }));
  return jsonResponse(V1MeetingSearchResponse, { meetings }, "none");
});
