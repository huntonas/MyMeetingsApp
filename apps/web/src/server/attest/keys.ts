import { DatabaseError } from "pg";

import { db } from "@/db/client";
import { devices } from "@/db/schema";
import { ApiError } from "@/lib/api/respond";
import type { WriteDevice } from "@/server/devices/write-request";

// Spec §6: a registered key replaces any earlier one on the phone's row (a reinstall or restore makes a new key) and
// starts at counter 0. Replacing a key never moves last-seen: the nightly fold does (Task 5A); a phone with no row yet
// gets one with today's first and last seen, from the column defaults. Registration isn't a tag write and runs as one
// statement of its own, but the app registers just before its first write, so this row can sit a transaction id or
// two from that write's tag rows. The next nightly fold rewrites it (the phone wrote, so it has a device_days row), so
// that neighbour lasts at most a night, inside the 7-day audit window (spec §2).
export async function saveAttestKey(device: WriteDevice, keyId: string, publicKey: string): Promise<void> {
  const key = { attestKeyId: keyId, attestPublicKey: publicKey, attestCounter: 0 };
  try {
    await db
      .insert(devices)
      .values({ ...device, ...key })
      .onConflictDoUpdate({ target: devices.deviceHash, set: key });
  } catch (error) {
    // Apple: a key must belong to one device, so a replayed registration can't move it to another. The unique index
    // decides, even for two phones saving the same key at once.
    const constraint =
      error instanceof Error && error.cause instanceof DatabaseError ? error.cause.constraint : undefined;
    if (constraint === "devices_attest_key_idx") throw new ApiError("attestation_failed");
    throw error;
  }
}
