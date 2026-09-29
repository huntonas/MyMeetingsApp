import type { DeleteMineResponse } from "@mymeetingapp/shared";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { aiDecisions, devices, rateLimits, suggestions, tagAudit } from "@/db/schema";
import { lockDevice, type WriteDevice } from "@/server/devices/write-request";
import { changeEverySubmission } from "@/server/tags/own-submissions";

// Spec §7: every tag, rate-limit, audit and device row for this device, and counts updated, plus each suggestion
// still linked to it and that suggestion's AI decisions (a reviewed suggestion no longer names any device). Works
// even while tagging is switched off. A blocked device keeps only its hash and block (owner decision), so
// deleting can't lift a block; that row links to no meeting.
export async function deleteMine(device: WriteDevice): Promise<DeleteMineResponse> {
  return db.transaction(async (tx) => {
    await lockDevice(device.deviceHash, tx);
    const deletedTags = await changeEverySubmission(device.deviceHash, "delete", tx);
    await tx.delete(tagAudit).where(eq(tagAudit.deviceHash, device.deviceHash));
    await tx.delete(rateLimits).where(eq(rateLimits.deviceHash, device.deviceHash));
    // Locked first, so a screening recording its decision now (outside the device lock) finishes before this
    // deletes the decisions, or waits and then finds its suggestion gone.
    const linked = await tx
      .select({ id: suggestions.id })
      .from(suggestions)
      .where(eq(suggestions.deviceHash, device.deviceHash))
      .for("update");
    await tx.delete(aiDecisions).where(
      inArray(
        aiDecisions.suggestionId,
        linked.map((row) => row.id),
      ),
    );
    await tx.delete(suggestions).where(eq(suggestions.deviceHash, device.deviceHash));
    await tx
      .delete(devices)
      .where(and(eq(devices.deviceHash, device.deviceHash), eq(devices.blocked, false)));
    return { deletedTags };
  });
}
