import { sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { sqlArray } from "@/db/sql";
import { listingSide, sidesMatch } from "@/server/meetings/match";
import { recomputeMeetings } from "@/server/meetings/recompute";

// Spec §3: repairs meetings that older, looser rules built (a men's and a women's listing at one address,
// unrelated listings sharing a placeholder Zoom URL). Each active listing, other than the meeting's primary
// one, that matches no other listing on its meeting by sidesMatch moves to a new meeting of its own; the
// merge pass then lets it join wherever it truly matches. Asking "matches any other listing" rather than
// "matches the primary" keeps a chain (A~B~C, where A and C don't match directly) whole. Archived listings
// count as partners because the merge pass counts them too, so a listing they hold isn't split off only to
// merge straight back. One set-based statement; returns the new meetings' ids.
export async function splitUnmatchedListings(meetingIds: string[], executor: Executor): Promise<string[]> {
  if (meetingIds.length === 0) return [];
  const result = await executor.execute<{ id: string; from_meeting: string }>(sql`
    with detached as (
      select listing.id, listing.meeting_id from_meeting, listing.day, listing.time,
        gen_random_uuid() meeting_id
      from meetings m
      join feed_meetings listing on listing.meeting_id = m.id
      where m.id = any(${sqlArray(meetingIds, "uuid")}) and m.archived_at is null
        and listing.archived_at is null and listing.id <> m.primary_feed_meeting_id
        and not exists (
          select 1 from feed_meetings other
          where other.meeting_id = m.id and other.id <> listing.id
            and ${sidesMatch(listingSide("listing"), listingSide("other"))}
        )
    ),
    created as (insert into meetings (id, day, time) select meeting_id, day, time from detached),
    moved as (
      update feed_meetings set meeting_id = detached.meeting_id from detached
      where feed_meetings.id = detached.id
      returning detached.meeting_id, detached.from_meeting
    )
    select meeting_id id, from_meeting from moved
  `);
  const created = result.rows.map((row) => row.id);
  await recomputeMeetings(
    [...new Set([...created, ...result.rows.map((row) => row.from_meeting)])],
    executor,
  );
  return created;
}
