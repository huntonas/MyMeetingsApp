import { DEVICE_HEADERS, isOlderVersion, type Platform, WriteHeaders } from "@mymeetingapp/shared";
import { eq, sql } from "drizzle-orm";

import { db, type Executor } from "@/db/client";
import { devices } from "@/db/schema";
import { parseInput } from "@/lib/api/request";
import { ApiError } from "@/lib/api/respond";
import { readAppConfig } from "@/server/app-config";
import { verifyAttestation } from "@/server/devices/attestation";
import { recordDeviceDay } from "@/server/devices/device-days";
import { deviceHash } from "@/server/devices/ids";

export interface WriteDevice {
  platform: Platform;
  deviceHash: string;
}

function readDeviceHeaders(req: Request) {
  return parseInput(WriteHeaders, {
    deviceId: req.headers.get(DEVICE_HEADERS.deviceId) ?? undefined,
    platform: req.headers.get(DEVICE_HEADERS.platform) ?? undefined,
    appVersion: req.headers.get(DEVICE_HEADERS.appVersion) ?? undefined,
    attestation: req.headers.get(DEVICE_HEADERS.attestation) ?? undefined,
  });
}

// The raw id is hashed here and goes nowhere else: not into the database, the response or a log.
function verifiedDevice(headers: WriteHeaders): WriteDevice {
  const device = { platform: headers.platform, deviceHash: deviceHash(headers.platform, headers.deviceId) };
  verifyAttestation({ ...device, attestation: headers.attestation });
  return device;
}

// The phone a request names, hashed but not attested: for the app check's own endpoints, which run before the phone
// has a key. No version check (an app of any version may need a key to delete its data).
export function identifyDevice(req: Request): WriteDevice {
  const headers = readDeviceHeaders(req);
  return { platform: headers.platform, deviceHash: deviceHash(headers.platform, headers.deviceId) };
}

// Spec §7: every write carries X-Device-Id, X-Platform, X-App-Version and (when required) X-Attestation, and an
// app below the platform's minimum version must upgrade first.
export function readWriteRequest(req: Request): WriteDevice {
  const headers = readDeviceHeaders(req);
  if (isOlderVersion(headers.appVersion, readAppConfig().minSupportedVersion[headers.platform])) {
    throw new ApiError("upgrade_required");
  }
  return verifiedDevice(headers);
}

// A write that only deletes the device's own data. Spec §5 allows deletes at any time and §2 puts privacy over
// convenience, so no app version is too old to delete. The device is identified and attested exactly as for any
// write, so a forged id can't delete another device's data. Pair it with lockDevice, not writeAsDevice.
export function readDeletionRequest(req: Request): WriteDevice {
  return verifiedDevice(readDeviceHeaders(req));
}

// Serializes one device's writes for the rest of the transaction, so the 7-day rule and daily cap hold under
// concurrent requests. A transaction-level lock works through Neon's transaction-mode pooler. writeAsDevice takes
// it first; a deletion takes it alone, since it must work for a blocked device and records nothing about it.
export async function lockDevice(hash: string, executor: Executor): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${hash}, 0))`);
}

// Runs a device's write in one transaction under the device lock: refuses a blocked device, notes today in
// device_days, then writes. It never writes the device's record in `devices` (spec §2: that row would sit one
// transaction id from the write's tag rows); reading `blocked` takes no transaction id and stamps nothing. The nightly
// fold (foldDeviceDays) brings last-seen up to date. The block is read under the lock, so a device blocked in between
// is still refused.
export async function writeAsDevice<T>(device: WriteDevice, write: (tx: Executor) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await lockDevice(device.deviceHash, tx);
    const [row] = await tx
      .select({ blocked: devices.blocked })
      .from(devices)
      .where(eq(devices.deviceHash, device.deviceHash));
    if (row?.blocked === true) throw new ApiError("device_blocked");
    await recordDeviceDay(device, tx);
    return write(tx);
  });
}
