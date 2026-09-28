import { sql } from "drizzle-orm";

import { db } from "@/db/client";

// Add each new table here when it is created.
const APP_TABLES = [
  "rate_limits",
  "devices",
  "tag_audit",
  "tag_counts",
  "tag_submissions",
  "meeting_aliases",
  "feed_meetings",
  "meetings",
  "feeds",
  "address_geocodes",
  "tags",
];

export async function resetDb(): Promise<void> {
  await db.execute(sql.raw(`truncate table ${APP_TABLES.join(", ")} restart identity cascade`));
}

// Returns once some query is waiting on a row or table lock, or once `settled` says the racing work already
// finished without waiting (its assertions then catch that).
export async function untilWaitingOnLock(settled: () => boolean): Promise<void> {
  while (!settled()) {
    const result = await db.execute<{ waiting: number }>(sql`
      select count(*)::int waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
    `);
    if ((result.rows[0]?.waiting ?? 0) > 0) return;
  }
}
