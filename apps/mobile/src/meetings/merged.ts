import { inTransaction } from "@/db/database";

// Owner decision 6 (spec §7): GET /meetings/:id answers a merged-away id with the surviving meeting under its own id.
// Everything the phone keeps under the old id follows it.
export async function meetingMoved(from: string, to: string): Promise<void> {
  await inTransaction(async (db) => {
    await db.runAsync(
      "insert or replace into cache_entries (key, body, saved_at) select ?, body, saved_at from cache_entries where key = ?",
      [`meeting:${to}`, `meeting:${from}`],
    );
    await db.runAsync("delete from cache_entries where key = ?", [`meeting:${from}`]);
    // A favorite keeps its place in the Saved list. If both ids were saved, the survivor's own row stays.
    await db.runAsync(
      "insert or ignore into favorites (meeting_id, saved_at) select ?, saved_at from favorites where meeting_id = ?",
      [to, from],
    );
    await db.runAsync("delete from favorites where meeting_id = ?", [from]);
  });
}
