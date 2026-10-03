import { eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { deviceDays, devices } from "@/db/schema";
import { lockDevice } from "@/server/devices/write-request";
import { recountTags } from "@/server/tags/counts";
import { changeEverySubmission } from "@/server/tags/own-submissions";

// Spec §6: the admin blocks a device found through a flagged swing's audit rows. Its later writes get
// device_blocked. Its rows on every meeting (found as delete-mine finds them, merged-away scopes included) are
// excluded, and those meetings are recounted. The nightly recount keeps honoring the exclusion.
// The block commits on its own first (making the device's record from its days if the nightly fold hasn't yet), so
// the devices row doesn't share a transaction id (xmin) with the excluded rows, which would join the device to every
// meeting it tagged (spec §2). From then on every write is refused under the device lock, which the exclusion then
// takes, so it waits for a write already past that check. If the exclusion fails, running this again finishes it.
export async function blockDevice(deviceHash: string): Promise<{ excludedTags: number }> {
  if (!(await markBlocked(deviceHash))) throw new Error("No device has that hash");
  const excludedTags = await db.transaction(async (tx) => {
    await lockDevice(deviceHash, tx);
    const excluded = await changeEverySubmission(deviceHash, "exclude", tx);
    await recountTags(excluded.meetingIds, tx);
    return excluded.changed;
  });
  // The block committed at the transaction id just before the exclusion's, so the devices row is rewritten once
  // more to move its xmin off that neighbour. That rewrite also clears the App Attest key: the privacy policy keeps
  // no key on a blocked phone's record, and saveAttestKey never stores one there again.
  await db
    .update(devices)
    .set({ blocked: true, attestKeyId: null, attestPublicKey: null, attestCounter: null })
    .where(eq(devices.deviceHash, deviceHash));
  return { excludedTags };
}

// The block, committed on its own. A device that has written since the last nightly fold has no record yet, so it's
// made from its days, already blocked. False when the hash has neither.
async function markBlocked(deviceHash: string): Promise<boolean> {
  const updated = await db
    .update(devices)
    .set({ blocked: true })
    .where(eq(devices.deviceHash, deviceHash))
    .returning({ deviceHash: devices.deviceHash });
  if (updated.length > 0) return true;
  const made = await db.execute<{ device_hash: string }>(sql`
    insert into ${devices} (device_hash, platform, first_seen_date, last_seen_date, blocked)
    select device_hash, min(platform), min(day), max(day), true from ${deviceDays}
      where device_hash = ${deviceHash} group by device_hash
    on conflict (device_hash) do update set blocked = true
    returning device_hash
  `);
  return made.rows.length > 0;
}
