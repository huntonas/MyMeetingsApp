import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { z } from "zod";

import { MIGRATIONS } from "@/db/migrations";

export type AppDatabase = Pick<
  SQLiteDatabase,
  "execAsync" | "runAsync" | "getAllAsync" | "getFirstAsync" | "withTransactionAsync"
>;

const Version = z.object({ user_version: z.number().int() });

async function migrate(db: AppDatabase): Promise<AppDatabase> {
  const { user_version: current } = Version.parse(await db.getFirstAsync("pragma user_version", []));
  // Migrations run before appDatabase() resolves, so no inTransaction() can start alongside them.
  for (const [index, statement] of MIGRATIONS.entries()) {
    if (index < current) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(statement);
      await db.execAsync(`pragma user_version = ${String(index + 1)}`);
    });
  }
  return db;
}

let opening: Promise<AppDatabase> | undefined;

// The one database for everything the phone keeps: saved server responses and personal data. It never leaves the
// phone except in the phone's own backups (owner decision 6).
export function appDatabase(): Promise<AppDatabase> {
  opening ??= openDatabaseAsync("mymeetingapp.db")
    .then(migrate)
    .catch((error: unknown) => {
      // A failed open (or migration) isn't remembered: without this, one transient failure would fail every later
      // call too, forever, since `opening` would stay set to this same rejected promise.
      opening = undefined;
      throw error;
    });
  return opening;
}

let turn: Promise<unknown> = Promise.resolve();

// Runs `task` in a transaction once every transaction started before it has finished: SQLite (and expo-sqlite) refuse
// to begin one inside another, so two at once would lose the second. The one way to write in a transaction.
// Never call inTransaction (or anything that does) inside `task`: it would wait for its own turn forever. A single
// statement outside the queue joins any transaction open at the time and is undone if that rolls back, so only writes
// that really are best effort (the cache and recent places) run that way; personal data (favorites, the sobriety
// date) is always written through here.
export function inTransaction(task: (db: AppDatabase) => Promise<void>): Promise<void> {
  const run = turn.then(async () => {
    const db = await appDatabase();
    await db.withTransactionAsync(() => task(db));
  });
  // A failed transaction still hands over the turn.
  turn = run.catch(() => undefined);
  return run;
}
