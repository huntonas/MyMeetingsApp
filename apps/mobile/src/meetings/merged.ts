import { appDatabase } from "@/db/database";

// Owner decision 6 (spec §7): GET /meetings/:id answers a merged-away id with the surviving meeting under its own id.
// Everything the phone keeps under the old id follows it.
export async function meetingMoved(from: string, to: string): Promise<void> {
  const db = await appDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "insert or replace into cache_entries (key, body, saved_at) select ?, body, saved_at from cache_entries where key = ?",
      [`meeting:${to}`, `meeting:${from}`],
    );
    await db.runAsync("delete from cache_entries where key = ?", [`meeting:${from}`]);
  });
}
