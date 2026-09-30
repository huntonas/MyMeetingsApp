import { z } from "zod";

import { appDatabase, inTransaction } from "@/db/database";

const Row = z.object({ body: z.string(), saved_at: z.number() });

export async function readCache(key: string): Promise<{ body: unknown; savedAt: Date } | null> {
  const db = await appDatabase();
  const row = await db.getFirstAsync("select body, saved_at from cache_entries where key = ?", [key]);
  if (row === null) return null;
  const { body, saved_at } = Row.parse(row);
  const parsed: unknown = JSON.parse(body);
  return { body: parsed, savedAt: new Date(saved_at) };
}

export async function writeCache(key: string, body: unknown, savedAt: Date = new Date()): Promise<void> {
  const db = await appDatabase();
  await db.runAsync("insert or replace into cache_entries (key, body, saved_at) values (?, ?, ?)", [
    key,
    JSON.stringify(body),
    savedAt.getTime(),
  ]);
}

// Spec §8 keeps only the last search results offline. Saving and pruning happen in one transaction, and the save is
// skipped entirely if a newer search is already saved: two searches can resolve out of order (a slow request started
// first can still finish last), and without this an older one finishing late would both overwrite a newer result
// under a different key and then delete it while pruning.
export async function writeSearchResult(key: string, body: unknown, savedAt: Date): Promise<void> {
  await inTransaction(async (db) => {
    const newer = await db.getFirstAsync(
      "select 1 from cache_entries where key like 'search:%' and key <> ? and saved_at > ?",
      [key, savedAt.getTime()],
    );
    if (newer !== null) return;
    await db.runAsync("insert or replace into cache_entries (key, body, saved_at) values (?, ?, ?)", [
      key,
      JSON.stringify(body),
      savedAt.getTime(),
    ]);
    await db.runAsync("delete from cache_entries where key like 'search:%' and key <> ?", [key]);
  });
}
