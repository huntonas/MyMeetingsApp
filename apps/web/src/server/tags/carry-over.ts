import { sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { sqlArray } from "@/db/sql";
import { recountTags } from "@/server/tags/counts";

// Spec §3 and §5: tags survive a merge. This runs inside the merge, before the losers are deleted:
// - each loser becomes an alias of its survivor, and every alias of a loser now points at the survivor, so an
//   alias always names a live meeting in one step;
// - the loser's submissions move over with submitter ids and scopes unchanged, so a device still finds its row
//   by computing its id for the survivor and each alias;
// - its audit rows move too, and a group's opt-out on either meeting stays on the survivor;
// - losers and survivors are recounted, which clears the losers' counts now their submissions have moved.
export async function carryTagsOnMerge(
  pairs: { loser: string; survivor: string }[],
  executor: Executor,
): Promise<void> {
  if (pairs.length === 0) return;
  const losers = pairs.map((pair) => pair.loser);
  const survivors = pairs.map((pair) => pair.survivor);
  const merged = sql`unnest(${sqlArray(losers, "uuid")}, ${sqlArray(survivors, "uuid")}) as merged(loser, survivor)`;
  // Waits for tag writes holding any of these meetings (findTaggableMeeting) and keeps new ones out until the
  // merge commits, so no submission lands on a loser after its rows have moved. In id order, so two merges can't
  // deadlock.
  await executor.execute(sql`
    select 1 from meetings where id = any(${sqlArray([...losers, ...survivors], "uuid")}) order by id for update
  `);
  await executor.execute(sql`
    update meeting_aliases a set meeting_id = merged.survivor from ${merged} where a.meeting_id = merged.loser
  `);
  await executor.execute(sql`
    insert into meeting_aliases (old_meeting_id, meeting_id) select loser, survivor from ${merged}
  `);
  await executor.execute(sql`
    update tag_submissions s set meeting_id = merged.survivor from ${merged} where s.meeting_id = merged.loser
  `);
  await executor.execute(sql`
    update tag_audit a set meeting_id = merged.survivor from ${merged} where a.meeting_id = merged.loser
  `);
  await executor.execute(sql`
    update meetings survivor set tags_disabled = true
    from ${merged} join meetings loser on loser.id = merged.loser
    where survivor.id = merged.survivor and loser.tags_disabled
  `);
  await recountTags([...new Set([...losers, ...survivors])], executor);
}
