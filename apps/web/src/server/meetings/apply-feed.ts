import { and, eq, isNull, lt, sql } from "drizzle-orm";

import { db, type Executor } from "@/db/client";
import { conferenceKey, feedMeetings, meetings } from "@/db/schema";
import { sqlArray } from "@/db/sql";
import type { FeedMeeting } from "@/server/feeds/normalize";
import { type MatchSide, meetingSide, sidesMatch } from "@/server/meetings/match";
import { mergeDuplicateMeetings } from "@/server/meetings/merge";
import { recomputeMeetings } from "@/server/meetings/recompute";

// Spec §3 matching (see sidesMatch). A meeting that this feed lists under another slug in the same snapshot
// is excluded, so two rooms at one address and time stay separate, unless both listings share a conference
// key, which makes them one meeting.
async function findMatchingMeeting(
  tx: Executor,
  feedId: number,
  row: FeedMeeting,
  snapshotSlugs: readonly string[],
) {
  const rowConferenceKey = conferenceKey(sql`${row.conferenceUrl}::text`);
  const rowSide: MatchSide = {
    day: sql`${row.day}::smallint`,
    time: sql`${row.time}::text`,
    location:
      row.latitude !== null && row.longitude !== null
        ? sql`ST_SetSRID(ST_MakePoint(${row.longitude}, ${row.latitude}), 4326)::geography`
        : sql`null::geography`,
    listings: sql`(select ${row.addressKey}::text as address_key, ${row.attendance}::text as attendance,
      ${rowConferenceKey} as conference_key, ${row.name}::text as name)`,
  };
  const result = await tx.execute<{ id: string }>(sql`
    select meetings.id from meetings
    where ${sidesMatch(meetingSide("meetings"), rowSide)}
      and not exists (
        select 1 from feed_meetings same_feed
        where same_feed.meeting_id = meetings.id and same_feed.feed_id = ${feedId}
          and same_feed.day = ${row.day}
          and same_feed.source_slug = any(${sqlArray(snapshotSlugs, "text")})
          and not coalesce(same_feed.conference_key = ${rowConferenceKey}, false)
      )
    order by meetings.archived_at nulls first, meetings.created_at
    limit 1
  `);
  return result.rows[0]?.id;
}

// Spec §3: applies one feed's snapshot in one transaction — matching or creating a canonical meeting for
// each row, upserting the rows, archiving rows the feed no longer lists, recomputing every meeting the feed
// touches, and merging any of those meetings that now match another stored meeting.
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

    const touched = [...new Set(meetingByKey.values())];
    await recomputeMeetings(touched, tx);
    await mergeDuplicateMeetings(touched, tx);
  });
}
