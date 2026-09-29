import { sql } from "drizzle-orm";

import { db } from "@/db/client";

// Add each new table here when it is created.
const APP_TABLES = [
  "ai_decisions",
  "suggestions",
  "rate_limits",
  "devices",
  "tag_audit",
  "tag_counts",
  "tag_submissions",
  "tag_swings",
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

// Returns once `waiters` queries are waiting on a lock (row, table or advisory), or once `settled` says the
// racing work already finished without waiting (its assertions then catch that). Gives up after 5 seconds.
export async function untilWaitingOnLock(settled: () => boolean, waiters = 1): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!settled()) {
    const result = await db.execute<{ waiting: number }>(sql`
      select count(*)::int waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock'
    `);
    if ((result.rows[0]?.waiting ?? 0) >= waiters) return;
    if (Date.now() > deadline)
      throw new Error(`fewer than ${String(waiters)} queries waited on a lock within 5s`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
