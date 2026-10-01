import { DEVICE_HEADERS, WriteHeaders } from "@mymeetingapp/shared";
import { getAndroidId } from "expo-application";
import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { appPlatform, installedVersion } from "@/config/app-version";

// Spec §6: on iOS, a random UUID in the Keychain, readable only on this iPhone while it's unlocked. It is never synced
// to iCloud Keychain or restored to another phone, and it survives deleting and reinstalling the app. On Android,
// ANDROID_ID, which Android makes per app-signing key, user and device, and resets on a factory reset. The app
// never shows, logs or stores it anywhere else; it travels only in a write's headers, and the server keeps only its
// keyed hash (spec §2).
const KEY = "device-id";
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// A Keychain that can't be read throws here, so a new ID is made only when none is saved (or what's saved is no ID).
async function readOrMake(): Promise<string> {
  const saved = WriteHeaders.shape.deviceId.safeParse(await SecureStore.getItemAsync(KEY, OPTIONS));
  if (saved.success) return saved.data;
  const made = randomUUID();
  await SecureStore.setItemAsync(KEY, made, OPTIONS);
  return made;
}

// Android 7 writes ANDROID_ID with Long.toHexString, which drops leading zeros (about 1 phone in 16 there), and the
// server's check wants 16 digits; put them back. An empty ID stays empty and stops the write, rather than becoming one
// all-zero ID shared by every phone that has none.
function androidId(): string {
  const id = getAndroidId();
  return id === "" ? id : id.padStart(16, "0");
}

let reading: Promise<string> | undefined;

function deviceId(): Promise<string> {
  if (appPlatform() === "android") return Promise.resolve(androidId());
  // Two first writes at once share one new ID, rather than each saving its own.
  reading ??= readOrMake().finally(() => {
    reading = undefined;
  });
  return reading;
}

// Spec §7: the headers every write carries, and only writes. Parsed with the server's own contract, so an ID or a
// version the server would refuse stops the write before anything is sent. X-Attestation joins them in Phase 6.
export async function writeHeaders(): Promise<Record<string, string>> {
  const headers = WriteHeaders.parse({
    deviceId: await deviceId(),
    platform: appPlatform(),
    appVersion: installedVersion(),
  });
  return {
    [DEVICE_HEADERS.deviceId]: headers.deviceId,
    [DEVICE_HEADERS.platform]: headers.platform,
    [DEVICE_HEADERS.appVersion]: headers.appVersion,
  };
}
