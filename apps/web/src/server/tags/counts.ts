import type { TagCount } from "@mymeetingapp/shared";
import { type SQL, eq, inArray, sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { meetings, tagCounts } from "@/db/schema";
import { sqlArray } from "@/db/sql";
import { tagCountsJson } from "@/server/meetings/summary";

// Spec §5: a tag's count on a meeting is the number of non-excluded submissions that include it and were confirmed
// in the last 180 days. A device has one row per meeting, and counting distinct submitters keeps a row that lists a
// tag twice from counting twice. verified_count is how many of those were near the meeting: the tie-breaker when sorting.
function insertCounts(executor: Executor, where: SQL) {
  return executor.execute<{ meeting_id: string }>(sql`
    insert into ${tagCounts} (meeting_id, tag_id, device_count, verified_count)
    select s.meeting_id, tag_id, count(distinct s.submitter_id),
      count(distinct s.submitter_id) filter (where s.near_meeting)
    from tag_submissions s cross join lateral unnest(s.tag_ids) tag_id
    where ${where} and not s.excluded and s.confirmed_at > now() - interval '180 days'
    group by s.meeting_id, tag_id
    returning meeting_id
  `);
}

// Recounts these meetings in the caller's transaction, after any change to their submissions.
export async function recountTags(meetingIds: string[], executor: Executor): Promise<void> {
  if (meetingIds.length === 0) return;
  await executor.delete(tagCounts).where(inArray(tagCounts.meetingId, meetingIds));
  await insertCounts(executor, sql`s.meeting_id = any(${sqlArray(meetingIds, "uuid")})`);
}

// Spec §5: the nightly rebuild expires submissions older than 180 days and applies exclusions everywhere.
// Returns how many meetings have counts.
export async function recountAllTags(executor: Executor): Promise<number> {
  await executor.execute(sql`delete from ${tagCounts}`);
  const inserted = await insertCounts(executor, sql`true`);
  return new Set(inserted.rows.map((row) => row.meeting_id)).size;
}

// The counts a tag write returns, sorted and filtered exactly as meeting responses show them.
export async function meetingTagCounts(meetingId: string, executor: Executor): Promise<TagCount[]> {
  const [row] = await executor
    .select({ tags: tagCountsJson })
    .from(meetings)
    .where(eq(meetings.id, meetingId));
  return row?.tags ?? [];
}
