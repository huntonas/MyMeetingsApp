import { type SQL, inArray, sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { tagCounts } from "@/db/schema";
import { sqlArray } from "@/db/sql";

// Spec §5: a tag's count on a meeting is the number of non-excluded submissions that include it and were confirmed
// in the last 180 days. A device has one row per meeting and a row lists each tag once, so a device counts once.
// verified_count is how many of those were near the meeting: the tie-breaker when sorting.
function insertCounts(executor: Executor, where: SQL) {
  return executor.execute(sql`
    insert into ${tagCounts} (meeting_id, tag_id, device_count, verified_count)
    select s.meeting_id, tag_id, count(*), count(*) filter (where s.near_meeting)
    from tag_submissions s cross join lateral unnest(s.tag_ids) tag_id
    where ${where} and not s.excluded and s.confirmed_at > now() - interval '180 days'
    group by s.meeting_id, tag_id
  `);
}

// Recounts these meetings in the caller's transaction, after any change to their submissions.
export async function recountTags(meetingIds: string[], executor: Executor): Promise<void> {
  if (meetingIds.length === 0) return;
  await executor.delete(tagCounts).where(inArray(tagCounts.meetingId, meetingIds));
  await insertCounts(executor, sql`s.meeting_id = any(${sqlArray(meetingIds, "uuid")})`);
}
