import { z } from "zod";

import { appDatabase, inTransaction } from "@/db/database";
import type { CivilDate } from "@/time/civil-date";

const KEY = "sobriety_date";
const Stored = z.object({
  value: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((value) => value.split("-").map(Number)),
});

const pad = (value: number, width: number) => String(value).padStart(width, "0");

// Spec §2: the sobriety date is the person's own. It stays on the phone, and is never sent to our server or logged.
// It's stored as a plain calendar date, so a trip to another time zone or a clock change never moves it.
export async function readSobrietyDate(): Promise<CivilDate | null> {
  const db = await appDatabase();
  const row = await db.getFirstAsync("select value from settings where key = ?", [KEY]);
  if (row === null) return null;
  const [year = 0, month = 0, day = 0] = Stored.parse(row).value;
  return { year, month, day };
}

// Each write is its own transaction: a lone statement would join any transaction already open and be undone with it.
export function saveSobrietyDate(date: CivilDate): Promise<void> {
  const value = `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
  return inTransaction(async (db) => {
    await db.runAsync("insert or replace into settings (key, value) values (?, ?)", [KEY, value]);
  });
}

export function clearSobrietyDate(): Promise<void> {
  return inTransaction(async (db) => {
    await db.runAsync("delete from settings where key = ?", [KEY]);
  });
}
