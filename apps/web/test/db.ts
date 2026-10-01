import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { z } from "zod";

import { db, pool, type Executor } from "@/db/client";

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

// The server process behind a connection or transaction that holds locks, for untilWaitingOnLock.
export async function backendPid(holder: PoolClient | Executor): Promise<number> {
  const { rows } =
    // A drizzle executor has a `query` builder too, so a pooled client is told apart by `release`.
    "release" in holder
      ? await holder.query("select pg_backend_pid() as pid")
      : await holder.execute(sql`select pg_backend_pid() as pid`);
  const [{ pid }] = z.tuple([z.object({ pid: z.number() })]).parse(rows);
  return pid;
}

// Returns once `waiters` queries are waiting on a lock the `holder` process holds, directly or behind another waiter
// in its queue (row, table or advisory), or once `settled` says the racing work already finished without waiting
// (its assertions then catch that). Waiters on anything else (another test file's leftovers, autovacuum) never count.
// Gives up after 5 seconds.
export async function untilWaitingOnLock(holder: number, settled: () => boolean, waiters = 1): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!settled()) {
    const result = await db.execute<{ waiting: number }>(sql`
      with recursive blocked(pid) as (
        select pid from pg_stat_activity
        where datname = current_database() and ${holder}::int = any(pg_blocking_pids(pid))
        union
        select activity.pid from pg_stat_activity activity
        join blocked on blocked.pid = any(pg_blocking_pids(activity.pid))
        where activity.datname = current_database()
      )
      select count(*)::int waiting from blocked
    `);
    if ((result.rows[0]?.waiting ?? 0) >= waiters) return;
    if (Date.now() > deadline)
      throw new Error(`fewer than ${String(waiters)} queries waited on a lock within 5s`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// Holds the locks `lock` takes, in a transaction on its own connection, while `during` starts the racing work and
// waits for it to queue. Then it commits and returns the connection, even when `during` throws, so a failing test can
// never leave a lock or a checked-out connection behind for the next one. `during` must return before the racing
// work is awaited (return it inside an object), or it would wait on the lock this holds.
export async function whileHolding<T>(
  lock: string,
  params: unknown[],
  during: (holder: {
    pid: number;
    query: (text: string, params?: unknown[]) => Promise<unknown>;
  }) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("begin");
    await client.query(lock, params);
    const result = await during({
      pid: await backendPid(client),
      query: (text, values) => client.query(text, values),
    });
    await client.query("commit");
    committed = true;
    return result;
  } finally {
    if (!committed) await client.query("rollback").catch(() => undefined);
    client.release();
  }
}
