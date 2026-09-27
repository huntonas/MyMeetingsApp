import { and, eq, isNull, lt, sql } from "drizzle-orm";

import { db, type Executor } from "@/db/client";
import { feedMeetings, meetingLocation, meetings } from "@/db/schema";
import { sqlArray } from "@/db/sql";
import type { FeedMeeting } from "@/server/feeds/normalize";
import { recomputeMeetings } from "@/server/meetings/recompute";

const MATCH_DISTANCE_METERS = 50;

// Spec §3 matching: same day and start time, plus the same normalized address, coordinates within 50 m,
// or (online only) the same conference URL. A meeting that this feed lists under another slug in the same
// snapshot is excluded, so two rooms at one address and time stay separate.
async function findMatchingMeeting(
  tx: Executor,
  feedId: number,
  row: FeedMeeting,
  snapshotSlugs: readonly string[],
) {
  const point =
    row.latitude !== null && row.longitude !== null
      ? sql`ST_SetSRID(ST_MakePoint(${row.longitude}, ${row.latitude}), 4326)::geography`
      : null;
  const result = await tx.execute<{ id: string }>(sql`
    select meetings.id from meetings
    where meetings.day = ${row.day} and meetings.time = ${row.time}
      and (
        exists (
          select 1 from feed_meetings fm where fm.meeting_id = meetings.id and (
            (${row.addressKey}::text is not null and fm.address_key = ${row.addressKey})
            or (${row.attendance} = 'online' and fm.attendance = 'online' and fm.conference_url = ${row.conferenceUrl})
          )
        )
        ${point === null ? sql`` : sql`or ST_DWithin(${meetingLocation}, ${point}, ${MATCH_DISTANCE_METERS})`}
      )
      and not exists (
        select 1 from feed_meetings same_feed
        where same_feed.meeting_id = meetings.id and same_feed.feed_id = ${feedId}
          and same_feed.day = ${row.day}
          and same_feed.source_slug = any(${sqlArray(snapshotSlugs, "text")})
      )
    order by meetings.archived_at nulls first, meetings.created_at
    limit 1
  `);
  return result.rows[0]?.id;
}

// Spec §3: applies one feed's snapshot in one transaction — matching or creating a canonical meeting for
// each row, upserting the rows, archiving rows the feed no longer lists, and recomputing every meeting
// the feed touches.
export async function applyFeedSnapshot(feedId: number, rows: FeedMeeting[]): Promise<void> {
  await db.transaction(async (tx) => {
    const seenAt = new Date();
    const existing = await tx
      .select({
        sourceSlug: feedMeetings.sourceSlug,
        day: feedMeetings.day,
        meetingId: feedMeetings.meetingId,
      })
      .from(feedMeetings)
      .where(eq(feedMeetings.feedId, feedId));
    const meetingByKey = new Map(
      existing.map((row) => [`${row.sourceSlug}|${String(row.day)}`, row.meetingId]),
    );
    const snapshotSlugs = [...new Set(rows.map((row) => row.sourceSlug))];

    for (const row of rows) {
      const key = `${row.sourceSlug}|${String(row.day)}`;
      let meetingId = meetingByKey.get(key);
      if (meetingId === undefined) {
        meetingId = await findMatchingMeeting(tx, feedId, row, snapshotSlugs);
        if (meetingId === undefined) {
          const [created] = await tx
            .insert(meetings)
            .values({ day: row.day, time: row.time })
            .returning({ id: meetings.id });
          meetingId = created?.id;
        }
        if (meetingId === undefined) throw new Error("could not create a meeting");
        meetingByKey.set(key, meetingId);
      }
      await tx
        .insert(feedMeetings)
        .values({ ...row, feedId, meetingId, seenAt, archivedAt: null })
        .onConflictDoUpdate({
          target: [feedMeetings.feedId, feedMeetings.sourceSlug, feedMeetings.day],
          set: { ...row, seenAt, archivedAt: null },
        });
    }

    await tx
      .update(feedMeetings)
      .set({ archivedAt: seenAt })
      .where(
        and(
          eq(feedMeetings.feedId, feedId),
          lt(feedMeetings.seenAt, seenAt),
          isNull(feedMeetings.archivedAt),
        ),
      );

    await recomputeMeetings([...new Set([...meetingByKey.values()])], tx);
  });
}
