import type { TagCount } from "@mymeetingapp/shared";
import { type SQL, eq, sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { meetings, tagCounts, tagSubmissions } from "@/db/schema";
import { sqlArray } from "@/db/sql";
import { tagCountsJson } from "@/server/meetings/summary";

// Spec §5: a tag's count on a meeting is the number of non-excluded submissions that include it and were confirmed
// in the last 180 days. A device has one row per meeting, and counting distinct submitters keeps a row that lists a
// tag twice from counting twice. verified_count is how many of those were near the meeting: the tie-breaker when sorting.
// The CTE lets a caller that needs it (recountAllTags) get back how many distinct meetings were touched without
// pulling every row into Node; a caller that doesn't (recountTags) just ignores the one row it returns.
function insertCounts(executor: Executor, where: SQL) {
  return executor.execute<{ count: number }>(sql`
    with inserted as (
      insert into ${tagCounts} (meeting_id, tag_id, device_count, verified_count)
      select s.meeting_id, tag_id, count(distinct s.submitter_id),
        count(distinct s.submitter_id) filter (where s.near_meeting)
      from ${tagSubmissions} s cross join lateral unnest(s.tag_ids) tag_id
      where ${where} and not s.excluded and s.confirmed_at > now() - interval '180 days'
      group by s.meeting_id, tag_id
      returning meeting_id
    )
    select count(distinct meeting_id)::int as count from inserted
  `);
}

// Recounts these meetings in the caller's transaction, after any change to their submissions.
export async function recountTags(meetingIds: string[], executor: Executor): Promise<void> {
  if (meetingIds.length === 0) return;
  const ids = sqlArray(meetingIds, "uuid");
  await executor.delete(tagCounts).where(sql`${tagCounts.meetingId} = any(${ids})`);
  await insertCounts(executor, sql`s.meeting_id = any(${ids})`);
}

// Spec §5: the nightly rebuild expires submissions older than 180 days and applies exclusions everywhere.
// Locks tag_counts in EXCLUSIVE mode first (readers, e.g. meetingTagCounts, are still allowed) so this can't
// race a live tag write's recountTags: both insert into the same table on the same (meeting_id, tag_id) primary
// key, and without this lock either side can hit a duplicate-key error, failing a user's write or rolling back
// the nightly rebuild. The caller runs this in a transaction of its own that holds no other locks, so the lock is
// held only as long as this one statement pair takes, and never while this waits on anything a writer holds.
// Returns how many meetings have counts.
export async function recountAllTags(executor: Executor): Promise<number> {
  await executor.execute(sql`lock table ${tagCounts} in exclusive mode`);
  await executor.execute(sql`delete from ${tagCounts}`);
  const [row] = (await insertCounts(executor, sql`true`)).rows;
  return row?.count ?? 0;
}

// The counts a tag write returns, sorted and filtered exactly as meeting responses show them.
export async function meetingTagCounts(meetingId: string, executor: Executor): Promise<TagCount[]> {
  const [row] = await executor
    .select({ tags: tagCountsJson })
    .from(meetings)
    .where(eq(meetings.id, meetingId));
  return row?.tags ?? [];
}
