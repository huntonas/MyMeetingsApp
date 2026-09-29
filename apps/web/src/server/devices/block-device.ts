import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { devices } from "@/db/schema";
import { lockDevice } from "@/server/devices/write-request";
import { changeEverySubmission } from "@/server/tags/own-submissions";

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
    return { excludedTags: await changeEverySubmission(deviceHash, "exclude", tx) };
  });
}
