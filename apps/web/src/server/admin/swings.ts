import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { devices, feedMeetings, meetings, tagAudit, tagSubmissions, tagSwings, tags } from "@/db/schema";
import { FormId } from "@/server/admin/form-fields";
import type { AdminNotice } from "@/server/admin/notices";
import { logError } from "@/lib/log";
import { blockDevice } from "@/server/devices/block-device";
import { primarySourceJoin } from "@/server/meetings/summary";
import { RETENTION } from "@/server/retention";
import { findOwnSubmissions } from "@/server/tags/own-submissions";

export const BlockSwingDeviceForm = z.object({
  swingId: FormId,
  deviceHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export const CloseSwingForm = z.object({ swingId: FormId });

interface Swing {
  id: number;
  meetingId: string;
  meetingName: string;
  tagId: number;
  tagLabel: string;
  newDevices: number;
  priorDevices: number;
  flaggedAt: Date;
  reviewedAt: Date | null;
}

interface SwingDevice {
  deviceHash: string;
  blocked: boolean;
  lastAt: Date;
}

interface SwingReview {
  swing: Swing;
  devices: SwingDevice[];
}

function selectSwings() {
  return db
    .select({
      id: tagSwings.id,
      meetingId: tagSwings.meetingId,
      meetingName: sql<string>`coalesce(${feedMeetings.name}, 'Unnamed meeting')`,
      tagId: tagSwings.tagId,
      tagLabel: tags.label,
      newDevices: tagSwings.newDevices,
      priorDevices: tagSwings.priorDevices,
      flaggedAt: tagSwings.flaggedAt,
      reviewedAt: tagSwings.reviewedAt,
    })
    .from(tagSwings)
    .innerJoin(tags, eq(tags.id, tagSwings.tagId))
    .innerJoin(meetings, eq(meetings.id, tagSwings.meetingId))
    .leftJoin(feedMeetings, primarySourceJoin)
    .$dynamic();
}

export async function listOpenSwings(): Promise<Swing[]> {
  return selectSwings()
    .where(isNull(tagSwings.reviewedAt))
    .orderBy(desc(tagSwings.flaggedAt), desc(tagSwings.id));
}

// The device's current rows on the meeting, under any merged-away scope, that include the tag.
async function rowsHoldingTag(deviceHash: string, meetingId: string, tagId: number) {
  const own = await findOwnSubmissions(deviceHash, meetingId, db);
  if (own.length === 0) return [];
  return db
    .select({ excluded: tagSubmissions.excluded })
    .from(tagSubmissions)
    .where(
      and(
        eq(tagSubmissions.meetingId, meetingId),
        inArray(
          tagSubmissions.submitterId,
          own.map((row) => row.submitterId),
        ),
        sql`${tagId} = any(${tagSubmissions.tagIds})`,
      ),
    );
}

// Spec §6: the phones behind a flag are those the 7-day audit log shows writing to this meeting whose current tags
// on it include the flagged tag. This lists phones for one meeting only. Nothing lists a phone's meetings (spec §2).
async function swingDevices(swing: Swing): Promise<SwingDevice[]> {
  const audited = await db
    .select({
      deviceHash: tagAudit.deviceHash,
      blocked: sql<boolean>`coalesce(bool_or(${devices.blocked}), false)`,
      lastAt: sql`max(${tagAudit.at})`.mapWith(tagAudit.at),
    })
    .from(tagAudit)
    .leftJoin(devices, eq(devices.deviceHash, tagAudit.deviceHash))
    .where(
      and(
        eq(tagAudit.meetingId, swing.meetingId),
        gt(tagAudit.at, sql`now() - make_interval(days => ${RETENTION.auditDays}::int)`),
      ),
    )
    .groupBy(tagAudit.deviceHash)
    .orderBy(desc(sql`max(${tagAudit.at})`));
  const behind: SwingDevice[] = [];
  for (const row of audited) {
    const holding = await rowsHoldingTag(row.deviceHash, swing.meetingId, swing.tagId);
    if (holding.length === 0) continue;
    // A block that stopped before its exclusion leaves the phone blocked with its tags still counting. It shows as
    // not blocked, so the page offers Block again, which finishes it.
    behind.push({ ...row, blocked: row.blocked && holding.every((held) => held.excluded) });
  }
  return behind;
}

// A closed flag has nothing left to act on, so it lists no phones.
export async function readSwingReview(id: number): Promise<SwingReview | undefined> {
  const [swing] = await selectSwings().where(eq(tagSwings.id, id));
  if (swing === undefined) return undefined;
  return { swing, devices: swing.reviewedAt === null ? await swingDevices(swing) : [] };
}

// The hash comes from the review page's form, so it's checked against the review again before anything is blocked.
export async function blockSwingDevice(input: z.output<typeof BlockSwingDeviceForm>): Promise<AdminNotice> {
  const review = await readSwingReview(input.swingId);
  if (review === undefined) return "flag_not_found";
  if (!review.devices.some((device) => device.deviceHash === input.deviceHash)) return "not_in_review";
  // blockDevice commits the block before the exclusion (so the two never share a transaction id, spec §2), so a
  // failure may leave the phone blocked with its tags still counting: "failed" would wrongly say nothing changed.
  // Running blockDevice again finishes the job.
  try {
    await blockDevice(input.deviceHash);
  } catch (error) {
    logError("[admin] block stopped part-way", error);
    return "block_unfinished";
  }
  return "blocked";
}

export async function closeSwing(input: z.output<typeof CloseSwingForm>): Promise<AdminNotice> {
  const closed = await db
    .update(tagSwings)
    .set({ reviewedAt: sql`now()` })
    .where(and(eq(tagSwings.id, input.swingId), isNull(tagSwings.reviewedAt)))
    .returning({ id: tagSwings.id });
  return closed.length > 0 ? "closed" : "flag_not_found";
}
