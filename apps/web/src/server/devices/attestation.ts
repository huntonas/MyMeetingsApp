import {
  assertionClientData,
  type AttestationProof,
  parseAttestation,
  type Platform,
} from "@mymeetingapp/shared";

import { db } from "@/db/client";
import { readEnv } from "@/env";
import { ApiError } from "@/lib/api/respond";
import { verifyAssertion } from "@/server/attest/app-attest";
import { appAttestConfig } from "@/server/attest/config";
import { validDeviceCheckToken } from "@/server/attest/device-check";
import { hasAttestKey, highestCounter, registeredKey } from "@/server/attest/keys";
import { isBlocked } from "@/server/devices/blocked";
import type { DeviceProof } from "@/server/devices/write-request";

// The counter, not the clock, stops replays; the clock only stops an assertion being held for days, and a tighter
// window would refuse phones whose time is wrong (decision 3).
const CLOCK_WINDOW_MS = 24 * 60 * 60 * 1000;

interface AttestedRequest {
  platform: Platform;
  deviceHash: string;
  attestation: string | undefined;
  method: string;
  path: string;
  // The raw body text, exactly as received: the assertion signs these bytes.
  body: string;
  // A deletion of the device's own data, which a blocked device may make without a proof.
  deletion: boolean;
}

// Spec §6: verification sits behind REQUIRE_ATTESTATION so development works without it. Only "off" (or unset)
// turns it off, so a mistyped value fails closed.
function attestationRequired(): boolean {
  const value = readEnv("REQUIRE_ATTESTATION")?.toLowerCase();
  if (value === undefined || value === "off") return false;
  if (value !== "on") console.warn('[attestation] REQUIRE_ATTESTATION should be "on" or "off"; requiring it');
  return true;
}

// Checks the assertion and returns the key and counter it carries. The counter is checked here against what's known,
// and again under the device lock in the write's own transaction (assertFreshProof), where it is kept on today's
// device_days row: of two writes signed with one counter, only the first through the lock gets past.
async function verifyAppAttest(
  request: AttestedRequest,
  proof: Extract<AttestationProof, { kind: "appAttest" }>,
): Promise<DeviceProof> {
  const config = appAttestConfig();
  const publicKey = await registeredKey(request.deviceHash, proof.keyId);
  if (config === null || publicKey === null || Math.abs(Date.now() - proof.timestamp) > CLOCK_WINDOW_MS) {
    throw new ApiError("attestation_failed");
  }
  const counter = verifyAssertion({
    assertion: proof.assertion,
    clientData: assertionClientData({
      method: request.method,
      path: request.path,
      timestamp: proof.timestamp,
      body: request.body,
    }),
    publicKey,
    appId: config.appId,
    storedCounter: await highestCounter(request.deviceHash, proof.keyId, db),
  });
  return { kind: "appAttest", keyId: proof.keyId, counter };
}

// Spec §6: an iPhone's write carries an App Attest assertion over this exact request, or, on an iPhone without App
// Attest, a DeviceCheck token. Play Integrity arrives in Phase 6b, so until then a required check refuses Android. Off,
// the header is ignored entirely and there's no proof. A blocked device is answered before any proof is checked (its
// record keeps no key to check one with): a write gets device_blocked, which only the holder of its secret ID learns,
// and a deletion goes ahead without a proof, since its rows are already excluded and deleting always works (spec §6).
// The deletion reads the block again under the device lock (assertFreshProof).
export async function verifyAttestation(request: AttestedRequest): Promise<DeviceProof | undefined> {
  if (!attestationRequired()) return undefined;
  if (await isBlocked(request.deviceHash, db)) {
    if (!request.deletion) throw new ApiError("device_blocked");
    return { kind: "blockedDevice" };
  }
  const proof = request.attestation === undefined ? null : parseAttestation(request.attestation);
  if (request.platform !== "ios" || proof === null) throw new ApiError("attestation_failed");
  if (proof.kind === "appAttest") return verifyAppAttest(request, proof);
  // DeviceCheck proves less than an assertion (decision 8): a phone with an App Attest key can't fall back to it.
  if ((await hasAttestKey(request.deviceHash)) || !(await validDeviceCheckToken(proof.token))) {
    throw new ApiError("attestation_failed");
  }
  // A DeviceCheck token carries no counter: the write spends the token (assertFreshProof) and keeps only its day.
  return { kind: "deviceCheck", token: proof.token };
}
