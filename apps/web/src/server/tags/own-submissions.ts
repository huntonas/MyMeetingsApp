import { and, desc, eq, inArray, type SQL, sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { tagSubmissions } from "@/db/schema";
import { submitterId, submitterIds } from "@/server/devices/ids";
import { submitterScopes } from "@/server/meetings/aliases";

interface OwnSubmission {
  submitterId: string;
  nearMeeting: boolean;
  confirmedAt: Date;
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
