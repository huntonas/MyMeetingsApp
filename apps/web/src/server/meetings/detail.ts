import type { Fellowship } from "@mymeetingapp/shared";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { feedMeetings, meetings } from "@/db/schema";
import { resolveMeetingId } from "@/server/meetings/aliases";
import { inFellowship, primarySourceJoin, summaryColumns } from "@/server/meetings/summary";

// A merged-away id returns the surviving meeting under its own id (200), not a redirect: the app sees the new id
// in the body and updates its favorites and local tag record, and nothing caches a redirect under the old URL.
export async function getMeeting(id: string, fellowship: Fellowship | null) {
  const meetingId = await resolveMeetingId(id);
  const [row] = await db
    .select(summaryColumns)
    .from(meetings)
    .innerJoin(feedMeetings, primarySourceJoin)
    .where(and(eq(meetings.id, meetingId), isNull(meetings.archivedAt), inFellowship(fellowship)));
  return row;
}
