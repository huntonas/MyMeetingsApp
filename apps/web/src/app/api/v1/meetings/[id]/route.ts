import { MeetingDetailResponse, type MeetingSummary } from "@mymeetingapp/shared";
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
  // Drizzle widens `types` and `attendance` to string; `jsonResponse`'s parse enforces the real contract.
  return jsonResponse(MeetingDetailResponse, { meeting: meeting as MeetingSummary }, "meetingDetail");
});
