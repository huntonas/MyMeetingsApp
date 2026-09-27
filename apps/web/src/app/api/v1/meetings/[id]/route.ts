import { MeetingDetailResponse } from "@mymeetingapp/shared";
import { z } from "zod";

import { parseInput } from "@/lib/api/request";
import { ApiError, jsonResponse, withErrors } from "@/lib/api/respond";
import { getMeeting } from "@/server/meetings/detail";

export const dynamic = "force-dynamic";

const Params = z.object({ id: z.uuid() });

export const GET = withErrors(async (_req: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = parseInput(Params, await context.params);
  const meeting = await getMeeting(id);
  if (meeting === undefined) throw new ApiError("meeting_not_found");
  return jsonResponse(MeetingDetailResponse, { meeting }, "meetingDetail");
});
