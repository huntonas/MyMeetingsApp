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
  opening ??= openDatabaseAsync("mymeetingapp.db").then(migrate);
  return opening;
}
