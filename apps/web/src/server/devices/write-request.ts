import { DEVICE_HEADERS, isOlderVersion, type Platform, WriteHeaders } from "@mymeetingapp/shared";
import { sql } from "drizzle-orm";
import type { z } from "zod";

import { db, type Executor } from "@/db/client";
import { parseInput, parseJsonText } from "@/lib/api/request";
import { ApiError } from "@/lib/api/respond";
import { readAppConfig } from "@/server/app-config";
import { verifyAttestation } from "@/server/devices/attestation";
import { isBlocked } from "@/server/devices/blocked";
import { recordDeviceDay } from "@/server/devices/device-days";
import { deviceHash } from "@/server/devices/ids";

// What a write's verified proof carried: the App Attest key and counter of its assertion, or the DeviceCheck token
// Apple accepted (spent in the write's transaction), or, for a deletion from a blocked device, none at all (the block
// is read again under the device lock). Absent while checks are off.
export type DeviceProof =
  | { kind: "appAttest"; keyId: string; counter: number }
  | { kind: "deviceCheck"; token: string }
  | { kind: "blockedDevice" };

export interface WriteDevice {
  platform: Platform;
  deviceHash: string;
  proof?: DeviceProof;
}

function readDeviceHeaders(req: Request) {
  return parseInput(WriteHeaders, {
    deviceId: req.headers.get(DEVICE_HEADERS.deviceId) ?? undefined,
    platform: req.headers.get(DEVICE_HEADERS.platform) ?? undefined,
    appVersion: req.headers.get(DEVICE_HEADERS.appVersion) ?? undefined,
    attestation: req.headers.get(DEVICE_HEADERS.attestation) ?? undefined,
  });
}

function hashed(headers: WriteHeaders): WriteDevice {
  return { platform: headers.platform, deviceHash: deviceHash(headers.platform, headers.deviceId) };
}

// The raw id is hashed here and goes nowhere else: not into the database, the response or a log. The attestation is
// checked over the request's exact method, path and body text.
async function verifiedDevice(
  req: Request,
  headers: WriteHeaders,
  body: string,
  deletion: boolean,
): Promise<WriteDevice> {
  const device = hashed(headers);
  const proof = await verifyAttestation({
    ...device,
    attestation: headers.attestation,
    method: req.method,
    path: new URL(req.url).pathname,
    body,
    deletion,
  });
  return proof === undefined ? device : { ...device, proof };
}

// The phone a request names, hashed but not attested: for the app check's own endpoints, which run before the phone
// has a key. No version check (an app of any version may need a key to delete its data).
export function identifyDevice(req: Request): WriteDevice {
  return hashed(readDeviceHeaders(req));
}

// Spec §7: every write carries X-Device-Id, X-Platform, X-App-Version and (when required) X-Attestation, and an app
// below the platform's minimum version must upgrade first. The body is read here, as text, because the attestation
// signs its exact bytes; it is parsed with `schema` only after the check.
export async function readWriteRequest<Schema extends z.ZodType>(
  req: Request,
  schema: Schema,
): Promise<{ device: WriteDevice; body: z.output<Schema> }> {
  const headers = readDeviceHeaders(req);
  if (isOlderVersion(headers.appVersion, readAppConfig().minSupportedVersion[headers.platform])) {
    throw new ApiError("upgrade_required");
  }
  const text = await req.text();
  const device = await verifiedDevice(req, headers, text, false);
  return { device, body: parseJsonText(text, schema) };
}

// A write that only deletes the device's own data. Spec §5 allows deletes at any time and §2 puts privacy over
// convenience, so no app version is too old to delete. The device is identified and attested exactly as for any
// write (over an empty body), so a forged id can't delete another device's data, except that a blocked device needs
// no proof (verifyAttestation). Pair it with lockDevice and assertFreshProof, not writeAsDevice.
export async function readDeletionRequest(req: Request): Promise<WriteDevice> {
  return verifiedDevice(req, readDeviceHeaders(req), await req.text(), true);
}

// Serializes one device's writes for the rest of the transaction, so the 7-day rule and daily cap hold under
// concurrent requests. A transaction-level lock works through Neon's transaction-mode pooler. writeAsDevice takes
// it first; a deletion takes it alone, since it must work for a blocked device and records nothing about it.
export async function lockDevice(hash: string, executor: Executor): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${hash}, 0))`);
}

// Runs a device's write in one transaction under the device lock: refuses a blocked device, notes today in
// device_days (spending the proof: an App Attest counter is checked and kept there, a DeviceCheck token used up), then
// writes. It never writes the device's record in `devices` (spec §2: that row would sit one transaction id from the
// write's tag rows); reading `blocked` takes no transaction id and stamps nothing. A spent DeviceCheck token's row does
// share the write's transaction id, but it names no device. The nightly fold (foldDeviceDays) brings last-seen up to
// date. The block is read under the lock, so a device blocked in between is still refused.
export async function writeAsDevice<T>(device: WriteDevice, write: (tx: Executor) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await lockDevice(device.deviceHash, tx);
    if (await isBlocked(device.deviceHash, tx)) throw new ApiError("device_blocked");
    await recordDeviceDay(device, tx);
    return write(tx);
  });
}
