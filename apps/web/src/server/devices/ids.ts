import type { Platform } from "@mymeetingapp/shared";
import { createHmac, hkdfSync } from "node:crypto";

import { readEnv } from "@/env";

const MIN_PEPPER_LENGTH = 32;
const DEVICE_KEY_INFO = "mymeetingapp device_hash v1";
const SUBMITTER_KEY_INFO = "mymeetingapp submitter_id v1";

// Spec §2: both HMAC keys come from the one permanent pepper, so no key is stored anywhere. Changing the pepper
// or these info strings breaks every existing link between a device and its rows.
function derivedKey(info: string): Buffer {
  const pepper = readEnv("DEVICE_ID_PEPPER");
  if (pepper === undefined || pepper.length < MIN_PEPPER_LENGTH) {
    throw new Error(`DEVICE_ID_PEPPER must be set to at least ${String(MIN_PEPPER_LENGTH)} characters`);
  }
  return Buffer.from(hkdfSync("sha256", pepper, Buffer.alloc(0), info, 32));
}

function hmacHex(key: Buffer, message: string): string {
  return createHmac("sha256", key).update(message).digest("hex");
}

// device_hash = HMAC-SHA256(k_device, platform + ":" + rawId). The raw id goes no further than this function.
export function deviceHash(platform: Platform, rawId: string): string {
  return hmacHex(derivedKey(DEVICE_KEY_INFO), `${platform}:${rawId}`);
}

// submitter_id = HMAC-SHA256(k_submitter, device_hash + ":" + scopeMeetingId).
export function submitterId(hash: string, scopeMeetingId: string): string {
  return hmacHex(derivedKey(SUBMITTER_KEY_INFO), `${hash}:${scopeMeetingId}`);
}

// The same for many scopes, deriving the key once: blocking and delete-mine compute one per meeting (about 60k).
export function submitterIds(hash: string, scopeMeetingIds: readonly string[]): string[] {
  const key = derivedKey(SUBMITTER_KEY_INFO);
  return scopeMeetingIds.map((scope) => hmacHex(key, `${hash}:${scope}`));
}
