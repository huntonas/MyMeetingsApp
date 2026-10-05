import { randomBytes } from "node:crypto";

import type { AttestChallengeResponse } from "@mymeetingapp/shared";
import { and, eq, gt, lt, sql } from "drizzle-orm";

import { db, type Executor } from "@/db/client";
import { attestChallenges } from "@/db/schema";
import { consumeDailyLimit, consumeSiteChallenge } from "@/server/devices/rate-limit";
import type { WriteDevice } from "@/server/devices/write-request";
import { RETENTION } from "@/server/retention";

// Spec §6: a single-use challenge, kept 5 minutes. The daily count is the only trace of who asked; the stored challenge
// names no phone. Expired challenges are deleted first, so the table stays small between nightly purges. Counted and
// stored in one transaction, so a failed insert spends no allowance; the site-wide count comes last, so its one busy
// row is locked only until the commit.
export async function issueChallenge(device: WriteDevice): Promise<AttestChallengeResponse> {
  const challenge = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await deleteExpiredChallenges(tx);
    await tx.insert(attestChallenges).values({
      challenge,
      expiresAt: sql`now() + make_interval(mins => ${RETENTION.challengeMinutes}::int)`,
    });
    await consumeDailyLimit(device.deviceHash, "attestation", tx);
    await consumeSiteChallenge(tx);
  });
  return { challenge };
}

// The challenges past their 5 minutes, through attest_challenges_expires_idx. Returns how many were deleted.
export async function deleteExpiredChallenges(executor: Executor): Promise<number> {
  const deleted = await executor
    .delete(attestChallenges)
    .where(lt(attestChallenges.expiresAt, sql`now()`))
    .returning({ challenge: attestChallenges.challenge });
  return deleted.length;
}

// Deleted as it's checked, so a challenge works once at most, whatever that attempt's outcome. An expired one isn't
// spent here; the next challenge issued, or the nightly maintenance, deletes it.
export async function spendChallenge(challenge: string): Promise<boolean> {
  const spent = await db
    .delete(attestChallenges)
    .where(and(eq(attestChallenges.challenge, challenge), gt(attestChallenges.expiresAt, sql`now()`)))
    .returning({ challenge: attestChallenges.challenge });
  return spent.length > 0;
}
