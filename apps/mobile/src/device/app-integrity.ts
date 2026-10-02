import { AttestRegisterRequest } from "@mymeetingapp/shared";
import AppIntegrity from "@modules/app-integrity";
import * as SecureStore from "expo-secure-store";

import { appPlatform } from "@/config/app-version";
import { withinTimeLimit } from "@/location/time-limit";

// Spec §6: the App Attest key's id, kept like the phone's ID: in the Keychain, on this phone only, while unlocked. The
// key itself never leaves the Secure Enclave. A reinstall keeps the id but not the key, so assertions then fail and a
// new key is made.
const KEY = "attest-key-id";
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type IntegritySupport = "appAttest" | "deviceCheck" | "none";

// The saved key is no longer on this phone (a reinstall, a restore, a migration): it has to be replaced.
export class StaleAttestKey extends Error {
  constructor() {
    super("This phone no longer has its App Attest key");
    this.name = "StaleAttestKey";
  }
}

// Which proof this phone can make: App Attest on almost every iPhone, DeviceCheck where App Attest isn't offered (an
// iPhone app on a Mac), none on a simulator or on Android (Play Integrity is Phase 6b).
export function integritySupport(): IntegritySupport {
  if (appPlatform() !== "ios" || AppIntegrity === null) return "none";
  if (AppIntegrity.isAppAttestSupported) return "appAttest";
  return AppIntegrity.isDeviceCheckSupported ? "deviceCheck" : "none";
}

function integrity(): NonNullable<typeof AppIntegrity> {
  if (AppIntegrity === null) throw new Error("App checks aren't available on this phone");
  return AppIntegrity;
}

export async function savedAttestKey(): Promise<string | null> {
  const saved = AttestRegisterRequest.shape.keyId.safeParse(await SecureStore.getItemAsync(KEY, OPTIONS));
  return saved.success ? saved.data : null;
}

export const rememberAttestKey = (keyId: string) => SecureStore.setItemAsync(KEY, keyId, OPTIONS);
export const forgetAttestKey = () => SecureStore.deleteItemAsync(KEY, OPTIONS);

// Apple's calls can wait on its servers, so each is bounded like a location call.
export const newAttestKey = () => withinTimeLimit(integrity().generateKey());
export const attestKey = (keyId: string, challenge: string) =>
  withinTimeLimit(integrity().attestKey(keyId, challenge));
export const deviceCheckToken = () => withinTimeLimit(integrity().deviceCheckToken());

export async function assertion(keyId: string, clientData: string): Promise<string> {
  try {
    return await withinTimeLimit(integrity().generateAssertion(keyId, clientData));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_INVALID_KEY") {
      throw new StaleAttestKey();
    }
    throw error;
  }
}
