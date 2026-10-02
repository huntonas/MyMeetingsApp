import { appDatabase, inTransaction } from "@/db/database";

// Spec §2, §8, §13: the attendance check's results stay on the phone. Only "near" is kept, per occurrence (the
// meeting and the start the check fell in), never a position; a new submission then sends it as nearMeeting.
export function recordNear(meetingId: string, occurrenceStart: Date): Promise<void> {
  return inTransaction(async (db) => {
    await db.runAsync(
      "insert or ignore into attendance_checks (meeting_id, occurrence_start) values (?, ?)",
      [meetingId, occurrenceStart.getTime()],
    );
  });
}

export async function wasNear(meetingId: string, occurrenceStart: Date): Promise<boolean> {
  const db = await appDatabase();
  const row = await db.getFirstAsync(
    "select 1 from attendance_checks where meeting_id = ? and occurrence_start = ?",
    [meetingId, occurrenceStart.getTime()],
  );
  return row !== null;
}
