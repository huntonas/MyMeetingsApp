import { isV1MeetingType, OnlineMeetingsQuery, V1OnlineMeetingsResponse } from "@mymeetingapp/shared";

import { parseInput } from "@/lib/api/request";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { onlineMeetings } from "@/server/meetings/online";

export const dynamic = "force-dynamic";

// One day at a time keeps nationwide online meetings well under the 4.5 MB response limit.
export const GET = withErrors(async (req: Request) => {
  const { day } = parseInput(OnlineMeetingsQuery, { day: new URL(req.url).searchParams.get("day") });
  // For builds before 1.1 (V1MeetingSummary).
  const meetings = (await onlineMeetings(day, "aa")).map((meeting) => ({
    ...meeting,
    types: meeting.types.filter(isV1MeetingType),
  }));
  return jsonResponse(V1OnlineMeetingsResponse, { meetings }, "onlineMeetings");
});
