import { eq, sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { feedMeetings, meetings } from "@/db/schema";
import { sqlArray } from "@/db/sql";
import { ApiError } from "@/lib/api/respond";
import { resolveMeetingId } from "@/server/meetings/aliases";
import { primarySourceJoin } from "@/server/meetings/summary";
import { taggingWindowOpen } from "@/server/tags/window";

// Names the per-meeting tag-write advisory locks. They use the two-int4 key form, a key space Postgres keeps
// apart from the single-bigint form used by the per-device lock (write-request.ts) and the feed-sync lock
// (run-sync.ts). Two meetings whose ids hash alike only share a lock, which is harmless.
const MEETING_TAG_LOCK_CLASS = 7_202_610;

// Takes these meetings' tag-write locks for the rest of the transaction, after the caller's device lock:
// - the advisory lock serializes tag writes to one meeting, since each recounts the meeting's tag_counts (delete,
//   then insert) and two at once would collide on its primary key;
// - FOR KEY SHARE on the row makes a write and the sync's merge take turns: the merge locks every meeting it merges
//   FOR UPDATE before moving their tags (carryTagsOnMerge), so a write never adds a row to a meeting the merge has
//   emptied and will delete, nor misses a row the merge is moving onto it. KEY SHARE doesn't wait for the routine
//   UPDATE every sync makes to a meeting (recomputeMeetings).
// Both in id order, the order the merge locks in, so writers that lock several meetings can't deadlock. Postgres
// evaluates a volatile select-list function after ORDER BY, so the advisory locks are taken in that order too.
export async function lockMeetingsForTags(meetingIds: string[], executor: Executor): Promise<void> {
  const ids = sqlArray(meetingIds, "uuid");
  await executor.execute(sql`
    select pg_advisory_xact_lock(${MEETING_TAG_LOCK_CLASS}, hashtext(id::text)) from unnest(${ids}) id order by id
  `);
  await executor.execute(
    sql`select 1 from ${meetings} where ${meetings.id} = any(${ids}) order by ${meetings.id} for key share`,
  );
}

// One meeting, locked (above) and then read. Nothing is returned when a merge deleted it while this waited.
async function lockedMeeting(meetingId: string, executor: Executor) {
  await lockMeetingsForTags([meetingId], executor);
  return executor
    .select({
      id: meetings.id,
      archived: sql<boolean>`${meetings.archivedAt} is not null`,
      tagsDisabled: meetings.tagsDisabled,
      online: sql<boolean>`coalesce(${feedMeetings.attendance} = 'online', false)`,
      windowOpen: taggingWindowOpen(new Date()),
    })
    .from(meetings)
    .leftJoin(feedMeetings, primarySourceJoin)
    .where(eq(meetings.id, meetingId));
}

// The meeting a tag write names, after following a merge, locked for the write (above). Every tag write calls it
// right after taking the device lock: through writeAsDevice, or lockDevice for a deletion. Archived meetings are
// returned too: edits and deletes work on them at any time, and new submissions check `archived`.
export async function findTaggableMeeting(requestedId: string, executor: Executor) {
  const [meeting] = await lockedMeeting(await resolveMeetingId(requestedId, executor), executor);
  if (meeting !== undefined) return meeting;
  // A merge that committed while this waited for the lock deleted the meeting, and its alias is now visible.
  const [merged] = await lockedMeeting(await resolveMeetingId(requestedId, executor), executor);
  if (merged === undefined) throw new ApiError("meeting_not_found");
  return merged;
}
