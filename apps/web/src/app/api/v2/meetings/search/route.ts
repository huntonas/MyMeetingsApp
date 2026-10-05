import { MeetingSearchRequest, MeetingSearchResponse } from "@mymeetingapp/shared";

import { readJsonBody } from "@/lib/api/request";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { searchMeetings } from "@/server/meetings/search";

export const dynamic = "force-dynamic";

// Spec §2: coordinates arrive rounded, only in this POST body, and are never stored, logged or cached. Every
// fellowship's meetings (the phone filters them), so the server never learns which one someone attends.
export const POST = withErrors(async (req: Request) => {
  const request = await readJsonBody(req, MeetingSearchRequest);
  return jsonResponse(MeetingSearchResponse, { meetings: await searchMeetings(request, null) }, "none");
});
