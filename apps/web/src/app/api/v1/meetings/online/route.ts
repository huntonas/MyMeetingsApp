import { OnlineMeetingsQuery, OnlineMeetingsResponse } from "@mymeetingapp/shared";

import { parseInput } from "@/lib/api/request";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { onlineMeetings } from "@/server/meetings/online";

export const dynamic = "force-dynamic";

// One day at a time keeps nationwide online meetings well under the 4.5 MB response limit.
export const GET = withErrors(async (req: Request) => {
  const { day } = parseInput(OnlineMeetingsQuery, { day: new URL(req.url).searchParams.get("day") });
  return jsonResponse(OnlineMeetingsResponse, { meetings: await onlineMeetings(day) }, "onlineMeetings");
});
