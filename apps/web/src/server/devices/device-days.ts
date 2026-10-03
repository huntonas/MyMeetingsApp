import { sql } from "drizzle-orm";

import { db, type Executor } from "@/db/client";
import { deviceDays, devices } from "@/db/schema";
import { utcToday } from "@/db/sql";
import { ApiError } from "@/lib/api/respond";
import { spendDeviceCheckToken } from "@/server/attest/device-check";
import { highestCounter } from "@/server/attest/keys";
import { isBlocked } from "@/server/devices/blocked";
import type { WriteDevice } from "@/server/devices/write-request";

// Spec §6: a proof works once. An assertion's counter must exceed every one its key signed before; a DeviceCheck token
// is spent. Called under the device lock, inside the write's transaction, so of two writes signed with one counter only
// the first through the lock gets past. Without a proof (checks off) there's nothing to check. A blocked device's
// deletion carries none: its block is read again here, under the lock, so only a device still blocked goes without.
export async function assertFreshProof(device: WriteDevice, tx: Executor): Promise<void> {
  const { proof } = device;
  if (proof === undefined) return;
  if (proof.kind === "blockedDevice") {
    if (!(await isBlocked(device.deviceHash, tx))) throw new ApiError("attestation_failed");
    return;
  }
  if (proof.kind === "deviceCheck") {
    await spendDeviceCheckToken(proof.token, tx);
    return;
  }
  const highest = await highestCounter(device.deviceHash, proof.keyId, tx);
  if (proof.counter <= highest) throw new ApiError("attestation_failed");
}

// Spec §2: a write never writes the device's record in `devices`, which would sit one transaction id from the write's
// tag rows and link the device to that meeting for as long as both stand. It notes the day here instead, inside its own
// transaction: a device-keyed row gone within two days, inside the window in which tag_audit holds the same link
// openly. A day already noted is left alone (no new row version, no lock), unless the write carries an App Attest
// proof: then today's row keeps its key and counter, which the nightly fold carries into the device's record. A write
// the server then refuses rolls this back with it, so a replay of a write that failed isn't caught here; it fails again
// on its own, inside the clock window.
export async function recordDeviceDay(device: WriteDevice, tx: Executor): Promise<void> {
  await assertFreshProof(device, tx);
  const row = { deviceHash: device.deviceHash, day: utcToday, platform: device.platform };
  if (device.proof?.kind !== "appAttest") {
    await tx.insert(deviceDays).values(row).onConflictDoNothing();
    return;
  }
  const key = { attestKeyId: device.proof.keyId, attestCounter: device.proof.counter };
  await tx
    .insert(deviceDays)
    .values({ ...row, ...key })
    .onConflictDoUpdate({ target: [deviceDays.deviceHash, deviceDays.day], set: key });
}

// Nightly, first in the maintenance run: every device with a day noted gets its record. A new device is added (first
// and last seen from its days), a known one has its last-seen day moved on, and its App Attest counter raised to the
// highest its current key signed (a phone without a key matches no day's key, so its counter stays null). One
// statement, so one transaction: every record it touches shares that one xmin, and none is rewritten by a tag write.
// It locks the days it folds (a key-share lock, which a write noting or raising its day doesn't wait for), so a
// delete-mine part way through deleting a phone's days is waited for and that phone skipped: the fold never brings
// back a record delete-mine deleted (spec §7). Returns how many devices it folded.
export async function foldDeviceDays(): Promise<number> {
  const folded = await db.execute<{ device_hash: string }>(sql`
    insert into ${devices} (device_hash, platform, first_seen_date, last_seen_date)
    select device_hash, min(platform), min(day), max(day)
    from (select * from ${deviceDays} for key share) days group by device_hash
    on conflict (device_hash) do update set
      last_seen_date = greatest(${devices.lastSeenDate}, excluded.last_seen_date),
      attest_counter = greatest(
        ${devices.attestCounter},
        (select max(d.attest_counter) from ${deviceDays} d
          where d.device_hash = ${devices.deviceHash} and d.attest_key_id = ${devices.attestKeyId})
      )
    returning device_hash
  `);
  return folded.rows.length;
}
