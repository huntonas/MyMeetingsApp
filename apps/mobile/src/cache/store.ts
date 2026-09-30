import { z } from "zod";

import { appDatabase } from "@/db/database";

const Row = z.object({ body: z.string(), saved_at: z.number() });

export async function readCache(key: string): Promise<{ body: unknown; savedAt: Date } | null> {
  const db = await appDatabase();
  const row = await db.getFirstAsync("select body, saved_at from cache_entries where key = ?", [key]);
  if (row === null) return null;
  const { body, saved_at } = Row.parse(row);
  const parsed: unknown = JSON.parse(body);
  return { body: parsed, savedAt: new Date(saved_at) };
}

export async function writeCache(key: string, body: unknown): Promise<void> {
  const db = await appDatabase();
  await db.runAsync("insert or replace into cache_entries (key, body, saved_at) values (?, ?, ?)", [
    key,
    JSON.stringify(body),
    Date.now(),
  ]);
}

// Spec §8 keeps only the last search results offline.
export async function forgetOtherSearches(keep: string): Promise<void> {
  const db = await appDatabase();
  await db.runAsync("delete from cache_entries where key like 'search:%' and key <> ?", [keep]);
}
