import { sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { meetingAliases, meetings, tagAudit, tagCounts, tagSubmissions, tagSwings } from "@/db/schema";
import { sqlArray } from "@/db/sql";
import { recountTags } from "@/server/tags/counts";

// Spec §3 and §5: tags survive a merge. This runs inside the merge, before the losers are deleted:
// - each loser becomes an alias of its survivor, and every alias of a loser now points at the survivor, so an
//   alias always names a live meeting in one step;
// - the loser's submissions move over with submitter ids and scopes unchanged, so a device still finds its row
//   by computing its id for the survivor and each alias;
// - its audit rows move too, and a group's opt-out on either meeting stays on the survivor;
// - and its swing flags (one open flag per tag survives);
// - losers and survivors are recounted, which clears the losers' counts now their submissions have moved.
export async function carryTagsOnMerge(
  pairs: { loser: string; survivor: string }[],
  executor: Executor,
): Promise<void> {
  if (pairs.length === 0) return;
  const losers = pairs.map((pair) => pair.loser);
  const survivors = pairs.map((pair) => pair.survivor);
  const merged = sql`unnest(${sqlArray(losers, "uuid")}, ${sqlArray(survivors, "uuid")}) as merged(loser, survivor)`;
  // The nightly recount (recountAllTags) locks tag_counts and then key-share locks meetings as it inserts, so the
  // merge takes its tag_counts lock before locking any meeting: the two then queue on tag_counts, never in a cycle.
  await executor.execute(sql`lock table ${tagCounts} in row exclusive mode`);
  // Waits for tag writes holding any of these meetings (findTaggableMeeting) and keeps new ones out until the
  // merge commits, so no submission lands on a loser after its rows have moved. In id order, so two merges can't
  // deadlock.
  await executor.execute(sql`
    select 1 from ${meetings} where id = any(${sqlArray([...losers, ...survivors], "uuid")}) order by id for update
  `);
  await executor.execute(sql`
    update ${meetingAliases} a set meeting_id = merged.survivor from ${merged} where a.meeting_id = merged.loser
  `);
  await executor.execute(sql`
    insert into ${meetingAliases} (old_meeting_id, meeting_id) select loser, survivor from ${merged}
  `);
  await executor.execute(sql`
    update ${tagSubmissions} s set meeting_id = merged.survivor from ${merged} where s.meeting_id = merged.loser
  `);
  await executor.execute(sql`
    update ${tagAudit} a set meeting_id = merged.survivor from ${merged} where a.meeting_id = merged.loser
  `);
  await executor.execute(sql`
    update ${meetings} survivor set tags_disabled = true
    from ${merged} join ${meetings} loser on loser.id = merged.loser
    where survivor.id = merged.survivor and loser.tags_disabled
  `);
  // A loser's open flag moves unless the survivor already has one open for that tag; a duplicate is dropped.
  await executor.execute(sql`
    update ${tagSwings} w set meeting_id = merged.survivor from ${merged}
    where w.meeting_id = merged.loser and (w.reviewed_at is not null or not exists (
      select 1 from ${tagSwings} open_flag
      where open_flag.meeting_id = merged.survivor and open_flag.tag_id = w.tag_id and open_flag.reviewed_at is null
    ))
  `);
  await executor.execute(sql`delete from ${tagSwings} where meeting_id = any(${sqlArray(losers, "uuid")})`);
  await recountTags([...new Set([...losers, ...survivors])], executor);
}
