import { isV1MeetingType, V1MeetingDetailResponse } from "@mymeetingapp/shared";
import { z } from "zod";

import { parseInput } from "@/lib/api/request";
import { ApiError, jsonResponse, withErrors } from "@/lib/api/respond";
import { getMeeting } from "@/server/meetings/detail";

export const dynamic = "force-dynamic";

const Params = z.object({ id: z.uuid() });

export const GET = withErrors(async (_req: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = parseInput(Params, await context.params);
  const meeting = await getMeeting(id, "aa");
  if (meeting === undefined) throw new ApiError("meeting_not_found");
  // For builds before 1.1 (V1MeetingSummary).
  return jsonResponse(
    V1MeetingDetailResponse,
    { meeting: { ...meeting, types: meeting.types.filter(isV1MeetingType) } },
    "meetingDetail",
  );
});
