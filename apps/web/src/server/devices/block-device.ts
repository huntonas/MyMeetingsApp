import { eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { devices, tagSubmissions } from "@/db/schema";
import { lockDevice } from "@/server/devices/write-request";
import { recountTags } from "@/server/tags/counts";
import { everySubmitterIdBatch } from "@/server/tags/own-submissions";

// Spec §6: the admin blocks a device found through a flagged swing's audit rows. Its later writes get
// device_blocked. Its rows on every meeting (found as delete-mine finds them, merged-away scopes included) are
// excluded, and those meetings are recounted. The nightly recount keeps honoring the exclusion.
export async function blockDevice(deviceHash: string): Promise<{ excludedTags: number }> {
  return db.transaction(async (tx) => {
    await lockDevice(deviceHash, tx);
    const blocked = await tx
      .update(devices)
      .set({ blocked: true })
      .where(eq(devices.deviceHash, deviceHash))
      .returning({ deviceHash: devices.deviceHash });
    if (blocked.length === 0) throw new Error("No device has that hash");
    const touched = new Set<string>();
    let excludedTags = 0;
    for (const batch of await everySubmitterIdBatch(deviceHash, tx)) {
      const excluded = await tx
        .update(tagSubmissions)
        .set({ excluded: true })
        .where(inArray(tagSubmissions.submitterId, batch))
        .returning({ meetingId: tagSubmissions.meetingId });
      excludedTags += excluded.length;
      for (const row of excluded) touched.add(row.meetingId);
    }
    await recountTags([...touched], tx);
    return { excludedTags };
  });
}
