import { AttestRegisterRequest } from "@mymeetingapp/shared";
import AppIntegrity from "@modules/app-integrity";
import * as SecureStore from "expo-secure-store";

import { appPlatform } from "@/config/app-version";
import { withinTimeLimit } from "@/location/time-limit";

// Spec §6: the App Attest key's id, kept like the phone's ID: in the Keychain, on this phone only, while unlocked. The
// key itself never leaves the Secure Enclave. A reinstall keeps the id but not the key, so assertions then fail and a
// new key is made.
const KEY = "attest-key-id";
// A key Apple couldn't attest because its servers were out of reach. Apple asks for the same key to be attested again
// later rather than a new one made, which would count against this phone's risk metric.
const UNATTESTED_KEY = "attest-key-unattested";
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

type IntegritySupport = "appAttest" | "deviceCheck" | "none";

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

// Apple's servers couldn't be reached (DCError.serverUnavailable), so no proof could be made just now. Kept apart
// from other failures because a write the server then refuses for want of a proof is worth retrying, not updating for.
export class AppleUnreachable extends Error {
  constructor() {
    super("Apple's servers couldn't be reached");
    this.name = "AppleUnreachable";
  }
}

const SERVER_UNAVAILABLE = "ERR_SERVER_UNAVAILABLE";

function integrity(): NonNullable<typeof AppIntegrity> {
  if (AppIntegrity === null) throw new Error("App checks aren't available on this phone");
  return AppIntegrity;
}

const hasCode = (error: unknown, code: string) =>
  typeof error === "object" && error !== null && "code" in error && error.code === code;

async function savedKeyId(item: string): Promise<string | null> {
  const saved = AttestRegisterRequest.shape.keyId.safeParse(await SecureStore.getItemAsync(item, OPTIONS));
  return saved.success ? saved.data : null;
}

export const savedAttestKey = () => savedKeyId(KEY);

export const rememberAttestKey = (keyId: string) => SecureStore.setItemAsync(KEY, keyId, OPTIONS);
export const forgetAttestKey = () => SecureStore.deleteItemAsync(KEY, OPTIONS);

// Apple's calls can wait on its servers, so each is bounded like a location call.
export async function deviceCheckToken(): Promise<string> {
  try {
    return await withinTimeLimit(integrity().deviceCheckToken());
  } catch (error) {
    if (hasCode(error, SERVER_UNAVAILABLE)) throw new AppleUnreachable();
    throw error;
  }
}

export async function assertion(keyId: string, clientData: string): Promise<string> {
  try {
    return await withinTimeLimit(integrity().generateAssertion(keyId, clientData));
  } catch (error) {
    if (hasCode(error, "ERR_INVALID_KEY")) throw new StaleAttestKey();
    throw error;
  }
}

// A key, attested by Apple over the server's challenge: the one kept from an attempt Apple's servers couldn't take,
// or else a new one. A key Apple attested, or refused for any other reason, is never kept, as it can't be attested
// again.
export async function attestNewKey(challenge: string): Promise<{ keyId: string; attestation: string }> {
  const keyId = (await savedKeyId(UNATTESTED_KEY)) ?? (await withinTimeLimit(integrity().generateKey()));
  try {
    const attestation = await withinTimeLimit(integrity().attestKey(keyId, challenge));
    await SecureStore.deleteItemAsync(UNATTESTED_KEY, OPTIONS);
    return { keyId, attestation };
  } catch (error) {
    if (!hasCode(error, SERVER_UNAVAILABLE)) {
      await SecureStore.deleteItemAsync(UNATTESTED_KEY, OPTIONS);
      throw error;
    }
    await SecureStore.setItemAsync(UNATTESTED_KEY, keyId, OPTIONS);
    throw new AppleUnreachable();
  }
}
