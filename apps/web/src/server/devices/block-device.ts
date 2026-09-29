import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { devices } from "@/db/schema";
import { lockDevice } from "@/server/devices/write-request";
import { recountTags } from "@/server/tags/counts";
import { changeEverySubmission } from "@/server/tags/own-submissions";

// Spec §6: the admin blocks a device found through a flagged swing's audit rows. Its later writes get
// device_blocked. Its rows on every meeting (found as delete-mine finds them, merged-away scopes included) are
// excluded, and those meetings are recounted. The nightly recount keeps honoring the exclusion.
// The block commits on its own first, so the devices row doesn't share a transaction id (xmin) with the excluded
// rows, which would join the device to every meeting it tagged (spec §2). From then on every write is refused
// under the device lock, which the exclusion then takes, so it waits for a write already past that check. If the
// exclusion fails, running this again finishes it.
export async function blockDevice(deviceHash: string): Promise<{ excludedTags: number }> {
  const blocked = await db
    .update(devices)
    .set({ blocked: true })
    .where(eq(devices.deviceHash, deviceHash))
    .returning({ deviceHash: devices.deviceHash });
  if (blocked.length === 0) throw new Error("No device has that hash");
  return db.transaction(async (tx) => {
    await lockDevice(deviceHash, tx);
    const excluded = await changeEverySubmission(deviceHash, "exclude", tx);
    await recountTags(excluded.meetingIds, tx);
    return { excludedTags: excluded.changed };
  });
}
