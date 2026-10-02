import type { DeleteMineResponse } from "@mymeetingapp/shared";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/db/client";
import { aiDecisions, deviceDays, devices, rateLimits, suggestions, tagAudit } from "@/db/schema";
import { lockDevice, type WriteDevice } from "@/server/devices/write-request";
import { recountTags } from "@/server/tags/counts";
import { changeEverySubmission } from "@/server/tags/own-submissions";

// Spec §7: every tag, rate-limit, audit, device_days and device row for this device, and counts updated, plus each
// suggestion still linked to it and that suggestion's AI decisions (a reviewed suggestion no longer names any device).
// Works even while tagging is switched off. A blocked device keeps only its hash and block (owner decision), so
// deleting can't lift a block; that row links to no meeting. Then the App Attest key on a blocked device's kept row
// goes too (spec §7: delete-mine deletes attestation data). That is its own statement after the transaction, so the
// kept row never shares a transaction id (xmin) with the tag_counts rows the deletion rewrote, which would join a
// blocked device to the meetings it tagged (spec §2). It usually lands on the next one, though, and that adjacency
// lasts until the nightly rebuild deletes and re-inserts every tag_counts row (recountAllTags). It touches only a
// row still holding a key, so a keyless row isn't moved next to those counts at all, and if it fails, deleting again
// finishes it.
export async function deleteMine(device: WriteDevice): Promise<DeleteMineResponse> {
  const response = await db.transaction(async (tx) => {
    await lockDevice(device.deviceHash, tx);
    const deleted = await changeEverySubmission(device.deviceHash, "delete", tx);
    await tx.delete(tagAudit).where(eq(tagAudit.deviceHash, device.deviceHash));
    await tx.delete(rateLimits).where(eq(rateLimits.deviceHash, device.deviceHash));
    await tx.delete(deviceDays).where(eq(deviceDays.deviceHash, device.deviceHash));
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
    // Last, as in every tag writer (see changeEverySubmission).
    await recountTags(deleted.meetingIds, tx);
    return { deletedTags: deleted.changed };
  });
  await db
    .update(devices)
    .set({ attestKeyId: null, attestPublicKey: null, attestCounter: null })
    .where(and(eq(devices.deviceHash, device.deviceHash), isNotNull(devices.attestKeyId)));
  return response;
}
