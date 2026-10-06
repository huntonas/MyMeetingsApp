import type { Fellowship, MeetingSearchRequest } from "@mymeetingapp/shared";
import { and, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { feedMeetings, meetingLocation, meetings } from "@/db/schema";
import { inFellowship, primarySourceJoin, summaryColumns } from "@/server/meetings/summary";

const MAX_RESULTS = 1000;

// Spec §2: coordinates are never logged, cached, or stored; this is the only place they touch SQL, as
// bound parameters that Drizzle's query logging never captures in application logs. The fellowship is in SQL, before
// the limit, so /api/v1's 1,000 are all AA meetings.
export async function searchMeetings(
  { lat, lng, radiusKm }: MeetingSearchRequest,
  fellowship: Fellowship | null,
) {
  const center = sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
  return db
    .select({
      ...summaryColumns,
      distanceKm: sql<number>`round((ST_Distance(${meetingLocation}, ${center}) / 1000)::numeric, 1)::float8`,
    })
    .from(meetings)
    .innerJoin(feedMeetings, primarySourceJoin)
    .where(
      and(
        isNull(meetings.archivedAt),
        inFellowship(fellowship),
        inArray(feedMeetings.attendance, ["in_person", "hybrid"]),
        sql`ST_DWithin(${meetingLocation}, ${center}, ${radiusKm * 1000})`,
      ),
    )
    .orderBy(sql`${meetingLocation} <-> ${center}`)
    .limit(MAX_RESULTS);
}
