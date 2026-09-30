import { z } from "zod";

import { appDatabase, inTransaction } from "@/db/database";

const Row = z.object({ meeting_id: z.string() });

// Favorites stay on the phone (spec §2, §8): nothing here is ever sent anywhere.
export async function favoriteIds(): Promise<string[]> {
  const db = await appDatabase();
  const rows = await db.getAllAsync(
    "select meeting_id from favorites order by saved_at desc, rowid desc",
    [],
  );
  return z
    .array(Row)
    .parse(rows)
    .map((row) => row.meeting_id);
}

export async function isFavorite(id: string): Promise<boolean> {
  const db = await appDatabase();
  return (await db.getFirstAsync("select meeting_id from favorites where meeting_id = ?", [id])) !== null;
}

// In its own transaction: a lone statement would join any transaction already open and be undone with it.
export function setFavorite(id: string, saved: boolean): Promise<void> {
  return inTransaction(async (db) => {
    if (saved)
      await db.runAsync("insert or ignore into favorites (meeting_id, saved_at) values (?, ?)", [
        id,
        Date.now(),
      ]);
    else await db.runAsync("delete from favorites where meeting_id = ?", [id]);
  });
}
