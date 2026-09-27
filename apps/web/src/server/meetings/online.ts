import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db/client";
import { feedMeetings, meetings } from "@/db/schema";
import { primarySourceJoin, summaryColumns } from "@/server/meetings/summary";

// The normalizer only marks a meeting online or hybrid when it has a conference URL or phone.
export async function onlineMeetings(day: number) {
  return db
    .select(summaryColumns)
    .from(meetings)
    .innerJoin(feedMeetings, primarySourceJoin)
    .where(
      and(
        isNull(meetings.archivedAt),
        eq(meetings.day, day),
        inArray(feedMeetings.attendance, ["online", "hybrid"]),
      ),
    )
    .orderBy(meetings.time, feedMeetings.name);
}
