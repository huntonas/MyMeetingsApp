import { and, desc, eq, inArray, type SQL, sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { tagSubmissions } from "@/db/schema";
import { submitterId, submitterIds } from "@/server/devices/ids";
import { submitterScopes } from "@/server/meetings/aliases";

const SUBMITTER_ID_BATCH = 5_000;

interface OwnSubmission {
  submitterId: string;
  nearMeeting: boolean;
  confirmedAt: Date;
  // Spec §5: confirmed less than 7 days ago by the database clock (the one the daily cap uses), so a new
  // submission would be too soon to count as a re-confirmation.
  confirmedThisWeek: boolean;
}

// Spec §2: a device's row is keyed by an HMAC of a meeting id. After merges that id may be any meeting merged into
// this one, so this checks every scope. More than one row comes back only when the device tagged two copies of a
// meeting that later merged. Newest confirmation first.
export async function findOwnSubmissions(
  deviceHash: string,
  meetingId: string,
  executor: Executor,
): Promise<OwnSubmission[]> {
  const ids = submitterIds(deviceHash, await submitterScopes(meetingId, executor));
  return executor
    .select({
      submitterId: tagSubmissions.submitterId,
      nearMeeting: tagSubmissions.nearMeeting,
      confirmedAt: tagSubmissions.confirmedAt,
      confirmedThisWeek: sql<boolean>`${tagSubmissions.confirmedAt} > now() - interval '7 days'`,
    })
    .from(tagSubmissions)
    .where(and(eq(tagSubmissions.meetingId, meetingId), inArray(tagSubmissions.submitterId, ids)))
    .orderBy(desc(tagSubmissions.confirmedAt));
}

// Writes the device's one row on a meeting under the meeting's own id, replacing the rows it held under any scope.
// The next lookup then needs a single match, and a device that tagged two merged copies counts once again.
export async function saveOwnSubmission(
  deviceHash: string,
  meetingId: string,
  replacing: OwnSubmission[],
  row: { tagIds: number[]; nearMeeting: boolean; confirmedAt: Date | SQL },
  executor: Executor,
): Promise<void> {
  if (replacing.length > 0) {
    await executor.delete(tagSubmissions).where(
      and(
        eq(tagSubmissions.meetingId, meetingId),
        inArray(
          tagSubmissions.submitterId,
          replacing.map((own) => own.submitterId),
        ),
      ),
    );
  }
  await executor.insert(tagSubmissions).values({
    meetingId,
    submitterId: submitterId(deviceHash, meetingId),
    scopeMeetingId: meetingId,
    ...row,
    updatedAt: sql`now()`,
  });
}

// Spec §6: a device's rows anywhere, found by computing its submitter id for every meeting and every merged-away
// id (about 60k HMACs). Batched so each statement stays well under Postgres's 65,535 bind parameters.
export async function everySubmitterIdBatch(deviceHash: string, executor: Executor): Promise<string[][]> {
  const scopes = await executor.execute<{ id: string }>(
    sql`select id from meetings union all select old_meeting_id from meeting_aliases`,
  );
  const ids = submitterIds(
    deviceHash,
    scopes.rows.map((row) => row.id),
  );
  const batches: string[][] = [];
  for (let start = 0; start < ids.length; start += SUBMITTER_ID_BATCH) {
    batches.push(ids.slice(start, start + SUBMITTER_ID_BATCH));
  }
  return batches;
}
