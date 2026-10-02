import { appDatabase } from "@/db/database";
import { TAGGING_WINDOW_MS } from "@/tagging/window";
import { DAY_MS } from "@/time/civil-date";

// Decision 4: a meeting's saved copy is kept 30 days unless the meeting is saved; an online list, 7 days. The last
// search is replaced by the next one, and the tag list and config are single rows, so neither needs pruning. An
// attendance result is useless once its occurrence's tagging window has closed (no new submission can send it).
export async function pruneCache(): Promise<void> {
  const db = await appDatabase();
  const now = Date.now();
  // "meeting:" is 8 characters, so the id starts at the 9th.
  await db.runAsync(
    "delete from cache_entries where key like 'meeting:%' and saved_at < ? and substr(key, 9) not in (select meeting_id from favorites)",
    [now - 30 * DAY_MS],
  );
  await db.runAsync("delete from cache_entries where key like 'online:%' and saved_at < ?", [
    now - 7 * DAY_MS,
  ]);
  await db.runAsync("delete from attendance_checks where occurrence_start <= ?", [now - TAGGING_WINDOW_MS]);
}
