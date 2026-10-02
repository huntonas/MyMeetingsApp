import { inTransaction } from "@/db/database";

// Owner decision 6 (spec §7): GET /meetings/:id answers a merged-away id with the surviving meeting under its own id.
// Everything the phone keeps under the old id follows it.
//
// `copy` says what becomes of the old id's saved copy. A read that found the merge saved the survivor's own details
// there, so they "move" to the survivor's key. A write that found it has only the old meeting's details, which would
// name the wrong meeting and could overwrite the survivor's own copy, so they "drop" and the survivor is read afresh.
export async function meetingMoved(from: string, to: string, copy: "move" | "drop"): Promise<void> {
  await inTransaction(async (db) => {
    if (copy === "move") {
      await db.runAsync(
        "insert or replace into cache_entries (key, body, saved_at) select ?, body, saved_at from cache_entries where key = ?",
        [`meeting:${to}`, `meeting:${from}`],
      );
    }
    await db.runAsync("delete from cache_entries where key = ?", [`meeting:${from}`]);
    // A favorite keeps its place in the Saved list. If both ids were saved, the survivor's own row stays.
    await db.runAsync(
      "insert or ignore into favorites (meeting_id, saved_at) select ?, saved_at from favorites where meeting_id = ?",
      [to, from],
    );
    await db.runAsync("delete from favorites where meeting_id = ?", [from]);
    // The phone's tag record follows too. If both ids were tagged, the more recently changed record is kept, as the
    // server keeps one row with the latest edit (an edit or removal answered for the survivor covers both).
    await db.runAsync(
      `insert into my_tags (meeting_id, name, tags, confirmed_at, updated_at)
       select ?, name, tags, confirmed_at, updated_at from my_tags where meeting_id = ? and true
       on conflict (meeting_id) do update set name = excluded.name, tags = excluded.tags,
         confirmed_at = excluded.confirmed_at, updated_at = excluded.updated_at
       where excluded.updated_at > my_tags.updated_at`,
      [to, from],
    );
    await db.runAsync("delete from my_tags where meeting_id = ?", [from]);
    // So do its attendance results, each kept once.
    await db.runAsync(
      "insert or ignore into attendance_checks (meeting_id, occurrence_start) select ?, occurrence_start from attendance_checks where meeting_id = ?",
      [to, from],
    );
    await db.runAsync("delete from attendance_checks where meeting_id = ?", [from]);
  });
}
