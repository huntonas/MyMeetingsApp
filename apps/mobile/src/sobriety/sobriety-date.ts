import { z } from "zod";

import { appDatabase } from "@/db/database";
import type { CivilDate } from "@/time/civil-date";

const KEY = "sobriety_date";
const Stored = z.object({
  value: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((value) => value.split("-").map(Number)),
});

const pad = (value: number, width: number) => String(value).padStart(width, "0");

// Spec §2: the sobriety date is the person's own. It stays on the phone, is never sent anywhere, and is never logged.
// It's stored as a plain calendar date, so a trip to another time zone or a clock change never moves it.
export async function readSobrietyDate(): Promise<CivilDate | null> {
  const db = await appDatabase();
  const row = await db.getFirstAsync("select value from settings where key = ?", [KEY]);
  if (row === null) return null;
  const [year = 0, month = 0, day = 0] = Stored.parse(row).value;
  return { year, month, day };
}

export async function saveSobrietyDate(date: CivilDate): Promise<void> {
  const db = await appDatabase();
  const value = `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
  await db.runAsync("insert or replace into settings (key, value) values (?, ?)", [KEY, value]);
}

export async function clearSobrietyDate(): Promise<void> {
  const db = await appDatabase();
  await db.runAsync("delete from settings where key = ?", [KEY]);
}
