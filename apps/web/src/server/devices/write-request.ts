import { Platform, SemVer } from "@mymeetingapp/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";

import type { Executor } from "@/db/client";
import { devices } from "@/db/schema";
import { parseInput } from "@/lib/api/request";
import { ApiError } from "@/lib/api/respond";
import { readAppConfig } from "@/server/app-config";
import { verifyAttestation } from "@/server/devices/attestation";
import { deviceHash } from "@/server/devices/ids";

// Spec §6: iOS sends a Keychain UUID and Android its ANDROID_ID (16 hex digits).
const WriteHeaders = z.object({
  deviceId: z.string().regex(/^[A-Za-z0-9-]{16,64}$/),
  platform: Platform,
  appVersion: SemVer,
  attestation: z.string().min(1).max(16_384).optional(),
});

export interface WriteDevice {
  platform: Platform;
  deviceHash: string;
}

function isOlder(version: string, minimum: string): boolean {
  const [a, b] = [version.split(".").map(Number), minimum.split(".").map(Number)];
  for (let i = 0; i < 3; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

// Spec §7: every write carries X-Device-Id, X-Platform, X-App-Version and (when required) X-Attestation. The raw
// id is hashed here and goes nowhere else: not into the database, the response or a log.
export function readWriteRequest(req: Request): WriteDevice {
  const headers = parseInput(WriteHeaders, {
    deviceId: req.headers.get("x-device-id") ?? undefined,
    platform: req.headers.get("x-platform") ?? undefined,
    appVersion: req.headers.get("x-app-version") ?? undefined,
    attestation: req.headers.get("x-attestation") ?? undefined,
  });
  if (isOlder(headers.appVersion, readAppConfig().minSupportedVersion[headers.platform])) {
    throw new ApiError("upgrade_required");
  }
  const device = { platform: headers.platform, deviceHash: deviceHash(headers.platform, headers.deviceId) };
  verifyAttestation({ ...device, attestation: headers.attestation });
  return device;
}

// Serializes one device's writes for the rest of the transaction, so the 7-day rule and daily cap hold under
// concurrent requests. A transaction-level lock works through Neon's transaction-mode pooler.
async function lockDevice(hash: string, executor: Executor): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${hash}, 0))`);
}

// Records the device's latest UTC day (spec §6) and refuses a blocked device.
export async function recordDevice(device: WriteDevice, executor: Executor): Promise<void> {
  await lockDevice(device.deviceHash, executor);
  const [row] = await executor
    .insert(devices)
    .values({ deviceHash: device.deviceHash, platform: device.platform })
    .onConflictDoUpdate({
      target: devices.deviceHash,
      set: { lastSeenDate: sql`(now() at time zone 'utc')::date` },
    })
    .returning({ blocked: devices.blocked });
  if (row?.blocked === true) throw new ApiError("device_blocked");
}
