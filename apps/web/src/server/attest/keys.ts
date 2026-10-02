import { and, eq, ne } from "drizzle-orm";

import { db } from "@/db/client";
import { devices } from "@/db/schema";
import { ApiError } from "@/lib/api/respond";
import type { WriteDevice } from "@/server/devices/write-request";

// Spec §6: a registered key replaces any earlier one on the phone's row (a reinstall or restore makes a new key) and
// starts at counter 0. It never sets last-seen: the nightly fold does (Task 5A). Registration isn't a tag write and
// runs as one statement of its own, but the app registers just before its first write, so this row can sit a
// transaction id or two from that write's tag rows. The next nightly fold rewrites it (the phone wrote, so it has a
// device_days row), so that neighbour lasts at most a night, inside the 7-day audit window (spec §2).
export async function saveAttestKey(device: WriteDevice, keyId: string, publicKey: string): Promise<void> {
  // Apple: a key must belong to one device, so a replayed registration can't move it to another.
  const [elsewhere] = await db
    .select({ deviceHash: devices.deviceHash })
    .from(devices)
    .where(and(eq(devices.attestKeyId, keyId), ne(devices.deviceHash, device.deviceHash)));
  if (elsewhere !== undefined) throw new ApiError("attestation_failed");
  const key = { attestKeyId: keyId, attestPublicKey: publicKey, attestCounter: 0 };
  await db
    .insert(devices)
    .values({ ...device, ...key })
    .onConflictDoUpdate({ target: devices.deviceHash, set: key });
}
