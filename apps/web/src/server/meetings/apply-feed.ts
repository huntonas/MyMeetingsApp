import type { Fellowship } from "@mymeetingapp/shared";
import { eq, sql } from "drizzle-orm";

import { db, type Executor } from "@/db/client";
import { conferenceKey, feedMeetings, feeds, meetings } from "@/db/schema";
import { sqlArray } from "@/db/sql";
import type { FeedMeeting } from "@/server/feeds/normalize";
import {
  type MatchSide,
  matchCandidates,
  meetingSide,
  sameFeedConflict,
  sidesMatch,
} from "@/server/meetings/match";
import { mergeDuplicateMeetings } from "@/server/meetings/merge";
import { recomputeMeetings } from "@/server/meetings/recompute";
import { splitUnmatchedListings } from "@/server/meetings/split";

// Spec §3 matching: sidesMatch on the candidates matchCandidates finds, less meetings that this feed lists
// under another slug now (sameFeedConflict "active": unlike the merge pass, which counts every listing ever
// seen, a renamed slug keeps its meeting). Archived meetings can match, so a meeting returning to a feed
// keeps its id, but an active one wins.
async function findMatchingMeeting(tx: Executor, feedId: number, fellowship: Fellowship, row: FeedMeeting) {
  const rowSide: MatchSide = {
    fellowship: sql`${fellowship}::text`,
    day: sql`${row.day}::smallint`,
    time: sql`${row.time}::text`,
    location:
      row.latitude !== null && row.longitude !== null
        ? sql`ST_SetSRID(ST_MakePoint(${row.longitude}, ${row.latitude}), 4326)::geography`
        : sql`null::geography`,
    listings: sql`(select ${row.addressKey}::text as address_key, ${row.attendance}::text as attendance,
      ${conferenceKey(sql`${row.conferenceUrl}::text`)} as conference_key, ${row.name}::text as name,
      ${sqlArray(row.types, "text")} as types, ${feedId}::integer as feed_id, ${row.sourceSlug}::text as source_slug,
      null::timestamptz as archived_at)`,
  };
  const meeting = meetingSide("meetings");
  const result = await tx.execute<{ id: string }>(sql`
    select meetings.id from (${matchCandidates(rowSide)}) candidate
    join meetings on meetings.id = candidate.candidate_id
    where ${sidesMatch(meeting, rowSide)} and not ${sameFeedConflict(meeting, rowSide, "active")}
    order by meetings.archived_at nulls first, meetings.created_at
    limit 1
  `);
  return result.rows[0]?.id;
}

// Spec §3: applies one feed's snapshot in one transaction — archiving rows the feed no longer lists,
// matching or creating a canonical meeting for each row, upserting the rows, recomputing every meeting the
// feed touches, splitting off listings that match nothing else on their meeting, and merging any of those
// meetings that now match another stored meeting.
export async function applyFeedSnapshot(feedId: number, rows: FeedMeeting[]): Promise<void> {
  await db.transaction(async (tx) => {
    const [feed] = await tx.select({ fellowship: feeds.fellowship }).from(feeds).where(eq(feeds.id, feedId));
    if (feed === undefined) throw new Error(`applyFeedSnapshot: no feed ${String(feedId)}`);
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
    // Rows the snapshot no longer lists are archived before matching, and rows it lists again are restored,
    // so sameFeedConflict sees which rooms this feed lists now.
    const snapshotKeys = rows.map((row) => `${row.sourceSlug}|${String(row.day)}`);
    await tx
      .update(feedMeetings)
      .set({
        archivedAt: sql`case when ${feedMeetings.sourceSlug} || '|' || ${feedMeetings.day}
          = any(${sqlArray(snapshotKeys, "text")}) then null else coalesce(${feedMeetings.archivedAt}, ${seenAt}) end`,
      })
      .where(eq(feedMeetings.feedId, feedId));

    for (const row of rows) {
      const key = `${row.sourceSlug}|${String(row.day)}`;
      let meetingId = meetingByKey.get(key);
      if (meetingId === undefined) {
        meetingId = await findMatchingMeeting(tx, feedId, feed.fellowship, row);
        if (meetingId === undefined) {
          const [created] = await tx
            .insert(meetings)
            .values({ day: row.day, time: row.time, fellowship: feed.fellowship })
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

    const touched = [...new Set(meetingByKey.values())];
    await recomputeMeetings(touched, tx);
    const detached = await splitUnmatchedListings(touched, tx);
    await mergeDuplicateMeetings([...touched, ...detached], tx);
  });
}
