import { z } from "zod";

import { type AppDatabase, appDatabase, inTransaction } from "@/db/database";

const Row = z.object({ body: z.string(), saved_at: z.number() });

// "Clear recent places" stamps when it forgot the last search, so a search asked for before then (still in flight)
// can't save its typed label afterwards.
const FORGOTTEN_AT = "searches_forgotten_at";
const Stamp = z.object({ value: z.string() });

type Saved = { body: unknown; savedAt: Date } | null;

function parseRow(row: unknown): Saved {
  if (row === null) return null;
  const { body, saved_at } = Row.parse(row);
  const parsed: unknown = JSON.parse(body);
  return { body: parsed, savedAt: new Date(saved_at) };
}

export async function readCache(key: string): Promise<Saved> {
  const db = await appDatabase();
  return parseRow(await db.getFirstAsync("select body, saved_at from cache_entries where key = ?", [key]));
}

// The one search kept offline (spec §8), whatever its key.
export async function readLastSearch(): Promise<Saved> {
  const db = await appDatabase();
  return parseRow(
    await db.getFirstAsync(
      "select body, saved_at from cache_entries where key like 'search:%' order by saved_at desc limit 1",
      [],
    ),
  );
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
    // A search asked for before "Clear recent places" ran (still in flight) must not save its typed label
    // afterwards. A stamp later than now was itself written before the phone's clock moved back; it isn't a real
    // "forgot since", so it's ignored the same way the `newer` check below ignores a future-stamped row.
    const stamp = await db.getFirstAsync("select value from settings where key = ?", [FORGOTTEN_AT]);
    if (stamp !== null) {
      const forgottenAt = Number(Stamp.parse(stamp).value);
      if (forgottenAt <= Date.now() && savedAt.getTime() < forgottenAt) return;
    }
    // A row stamped later than now was saved before the phone's clock moved back; it isn't newer, and counting it
    // would stop every later search being saved.
    const newer = await db.getFirstAsync(
      "select 1 from cache_entries where key like 'search:%' and key <> ? and saved_at > ? and saved_at <= ?",
      [key, savedAt.getTime(), Date.now()],
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

// Forgets the one kept search (its label, rounded point and answer), inside the caller's transaction: clearing recent
// places leaves nothing the person typed on the phone. Also stamps when, so a search already in flight is never
// saved afterwards (writeSearchResult's check above).
export async function forgetLastSearch(db: AppDatabase): Promise<void> {
  await db.runAsync("delete from cache_entries where key like 'search:%'", []);
  await db.runAsync("insert or replace into settings (key, value) values (?, ?)", [
    FORGOTTEN_AT,
    String(Date.now()),
  ]);
}
