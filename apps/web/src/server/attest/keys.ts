import { and, eq, sql } from "drizzle-orm";
import { DatabaseError } from "pg";

import { db, type Executor } from "@/db/client";
import { deviceDays, devices } from "@/db/schema";
import { ApiError } from "@/lib/api/respond";
import type { WriteDevice } from "@/server/devices/write-request";

// Spec §6: a registered key replaces any earlier one on the phone's row (a reinstall or restore makes a new key) and
// starts at counter 0. Replacing a key never moves last-seen: the nightly fold does (Task 5A); a phone with no row yet
// gets one with today's first and last seen, from the column defaults. Registration isn't a tag write and runs as one
// statement of its own, but the app registers just before its first write, so this row can sit a transaction id or
// two from that write's tag rows. The next nightly fold rewrites it (the phone wrote, so it has a device_days row), so
// that neighbour lasts at most a night, inside the 7-day audit window (spec §2). A blocked phone's record keeps no key
// (the privacy policy; blockDevice clears it), so a blocked phone's registration is refused with device_blocked, as its
// writes are. The block is read by the upsert itself, which waits for a block being made and then sees it.
export async function saveAttestKey(device: WriteDevice, keyId: string, publicKey: string): Promise<void> {
  const key = { attestKeyId: keyId, attestPublicKey: publicKey, attestCounter: 0 };
  let saved: unknown[];
  try {
    saved = await db
      .insert(devices)
      .values({ ...device, ...key })
      .onConflictDoUpdate({ target: devices.deviceHash, set: key, setWhere: eq(devices.blocked, false) })
      .returning({ deviceHash: devices.deviceHash });
  } catch (error) {
    // Apple: a key must belong to one device, so a replayed registration can't move it to another. The unique index
    // decides, even for two phones saving the same key at once.
    const constraint =
      error instanceof Error && error.cause instanceof DatabaseError ? error.cause.constraint : undefined;
    if (constraint === "devices_attest_key_idx") throw new ApiError("attestation_failed");
    throw error;
  }
  if (saved.length === 0) throw new ApiError("device_blocked");
}

// The phone's registered public key, when keyId is it.
export async function registeredKey(deviceHash: string, keyId: string): Promise<string | null> {
  const [row] = await db
    .select({ publicKey: devices.attestPublicKey })
    .from(devices)
    .where(and(eq(devices.deviceHash, deviceHash), eq(devices.attestKeyId, keyId)));
  return row?.publicKey ?? null;
}

// Whether the phone has registered an App Attest key: such a phone must prove each write with it (decision 8).
export async function hasAttestKey(deviceHash: string): Promise<boolean> {
  const [row] = await db
    .select({ keyId: devices.attestKeyId })
    .from(devices)
    .where(eq(devices.deviceHash, deviceHash));
  return (row?.keyId ?? null) !== null;
}

// The highest counter this key is known to have signed: the folded one on the device's record, or a higher one on a
// device_days row (Task 5A: a write keeps its counter there, never on devices). 0 for a key with neither.
export async function highestCounter(deviceHash: string, keyId: string, executor: Executor): Promise<number> {
  const { rows } = await executor.execute<{ highest: string | null }>(sql`
    select greatest(
      (select max(attest_counter) from ${deviceDays} where device_hash = ${deviceHash} and attest_key_id = ${keyId}),
      (select attest_counter from ${devices} where device_hash = ${deviceHash} and attest_key_id = ${keyId})
    )::text as highest
  `);
  return Number(rows[0]?.highest ?? 0);
}
