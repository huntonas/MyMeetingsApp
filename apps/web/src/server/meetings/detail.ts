import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { feedMeetings, meetings } from "@/db/schema";
import { primarySourceJoin, summaryColumns } from "@/server/meetings/summary";

// The row's `types` and `attendance` are widened to string by Drizzle's inference; `jsonResponse`'s
// `MeetingDetailResponse.parse` enforces the actual contract before the response leaves the server.
export async function getMeeting(id: string) {
  const [row] = await db
    .select(summaryColumns)
    .from(meetings)
    .innerJoin(feedMeetings, primarySourceJoin)
    .where(and(eq(meetings.id, id), isNull(meetings.archivedAt)));
  return row;
}
