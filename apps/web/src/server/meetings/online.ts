import type { Fellowship } from "@mymeetingapp/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { feedMeetings, meetings } from "@/db/schema";
import { inFellowship, primarySourceJoin, summaryColumns } from "@/server/meetings/summary";

// The normalizer only marks a meeting online or hybrid when it has a conference URL or phone. Listings that
// share a conference key (the same Zoom meeting under any host, or the same URL) are merged into one meeting
// when feeds are applied, so each appears once (spec §7).
export async function onlineMeetings(day: number, fellowship: Fellowship | null) {
  return db
    .select(summaryColumns)
    .from(meetings)
    .innerJoin(feedMeetings, primarySourceJoin)
    .where(
      and(
        isNull(meetings.archivedAt),
        inFellowship(fellowship),
        eq(meetings.day, day),
        inArray(feedMeetings.attendance, ["online", "hybrid"]),
      ),
    )
    .orderBy(meetings.time, feedMeetings.name);
}
