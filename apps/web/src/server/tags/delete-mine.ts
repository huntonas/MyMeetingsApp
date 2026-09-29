import type { DeleteMineResponse } from "@mymeetingapp/shared";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { devices, rateLimits, suggestions, tagAudit, tagSubmissions } from "@/db/schema";
import { lockDevice, type WriteDevice } from "@/server/devices/write-request";
import { recountTags } from "@/server/tags/counts";
import { everySubmitterIdBatch } from "@/server/tags/own-submissions";

// Spec §7: every tag, suggestion link, rate-limit, audit and device row for this device, and counts updated. Works
// even while tagging is switched off. A blocked device keeps only its hash and block (owner decision), so
// deleting can't lift a block; that row links to no meeting.
export async function deleteMine(device: WriteDevice): Promise<DeleteMineResponse> {
  return db.transaction(async (tx) => {
    await lockDevice(device.deviceHash, tx);
    const touched = new Set<string>();
    let deletedTags = 0;
    for (const batch of await everySubmitterIdBatch(device.deviceHash, tx)) {
      const deleted = await tx
        .delete(tagSubmissions)
        .where(inArray(tagSubmissions.submitterId, batch))
        .returning({ meetingId: tagSubmissions.meetingId });
      deletedTags += deleted.length;
      for (const row of deleted) touched.add(row.meetingId);
    }
    await tx.delete(tagAudit).where(eq(tagAudit.deviceHash, device.deviceHash));
    await tx.delete(rateLimits).where(eq(rateLimits.deviceHash, device.deviceHash));
    await tx
      .update(suggestions)
      .set({ deviceHash: null })
      .where(eq(suggestions.deviceHash, device.deviceHash));
    await tx
      .delete(devices)
      .where(and(eq(devices.deviceHash, device.deviceHash), eq(devices.blocked, false)));
    await recountTags([...touched], tx);
    return { deletedTags };
  });
}
