import { sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { sqlArray } from "@/db/sql";
import { matchCandidates, meetingSide, sidesMatch } from "@/server/meetings/match";
import { recomputeMeetings } from "@/server/meetings/recompute";

// Spec §3: stored meetings that match by the same rules as a new row (sidesMatch) merge into the oldest, so
// duplicates made before a rule existed merge as their feeds next sync. Two meetings that one feed lists under
// different slugs never merge (two rooms at one address and time), unless the listings share a conference
// key. Each round merges at most one meeting into each survivor and re-checks the survivor next round, so a
// feed's two rooms can't both join a third meeting at once. Every round is one set-based query.
export async function mergeDuplicateMeetings(meetingIds: string[], executor: Executor): Promise<void> {
  let touched = meetingIds;
  while (touched.length > 0) {
    const merged = await executor.execute<{ loser: string; survivor: string }>(sql`
      with touched as (select id from meetings where id = any(${sqlArray(touched, "uuid")})),
      candidate as (${matchCandidates("touched")}),
      matched as (
        select t.id a, other.id b from candidate
        join meetings t on t.id = candidate.touched_id and t.archived_at is null
        join meetings other on other.id = candidate.other_id and other.archived_at is null
        where ${sidesMatch(meetingSide("t"), meetingSide("other"))}
          and not exists (
            select 1 from feed_meetings mine
            join feed_meetings theirs on theirs.feed_id = mine.feed_id and theirs.source_slug <> mine.source_slug
            where mine.meeting_id = t.id and theirs.meeting_id = other.id
              and mine.archived_at is null and theirs.archived_at is null
              and not coalesce(mine.conference_key = theirs.conference_key, false)
          )
      ),
      pair as (
        select newer.id loser, newer.created_at loser_created_at, older.id survivor,
          older.created_at survivor_created_at
        from matched
        join meetings older on older.id in (matched.a, matched.b)
        join meetings newer on newer.id in (matched.a, matched.b)
        where (older.created_at, older.id) < (newer.created_at, newer.id)
      ),
      oldest_match as (
        select distinct on (loser) * from pair order by loser, survivor_created_at, survivor
      ),
      chosen as (
        select distinct on (survivor) loser, survivor from oldest_match
        where survivor not in (select loser from oldest_match)
        order by survivor, loser_created_at, loser
      ),
      moved as (
        update feed_meetings set meeting_id = chosen.survivor from chosen
        where feed_meetings.meeting_id = chosen.loser
        returning chosen.loser, chosen.survivor
      )
      select distinct loser, survivor from moved
    `);
    if (merged.rows.length === 0) return;
    const losers = merged.rows.map((row) => row.loser);
    const survivors = merged.rows.map((row) => row.survivor);
    await executor.execute(sql`delete from meetings where id = any(${sqlArray(losers, "uuid")})`);
    await recomputeMeetings(survivors, executor);
    touched = [...new Set([...touched.filter((id) => !losers.includes(id)), ...survivors])];
  }
}
