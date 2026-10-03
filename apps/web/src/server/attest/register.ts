import type { X509Certificate } from "node:crypto";

import type { AttestRegisterRequest } from "@mymeetingapp/shared";

import { ApiError } from "@/lib/api/respond";
import { sha256, verifyAttestationObject } from "@/server/attest/app-attest";
import { spendChallenge } from "@/server/attest/challenges";
import { appAttestConfig } from "@/server/attest/config";
import { saveAttestKey } from "@/server/attest/keys";
import type { WriteDevice } from "@/server/devices/write-request";

// Spec §6: verifies an iPhone's attestation and stores its key. The challenge is spent first, so it's gone whatever
// happens next. modules/app-integrity hands Apple SHA-256 of the challenge's text as the client data hash. `trust` is
// the root the chain must end at and the moment its certificates must be valid: the register route, the only
// production caller, passes APPLE_APP_ATTESTATION_ROOT and now; tests pass a made-up root.
export async function registerAppAttestKey(
  device: WriteDevice,
  request: AttestRegisterRequest,
  trust: { root: X509Certificate; at: Date },
): Promise<void> {
  const spent = await spendChallenge(request.challenge);
  const config = appAttestConfig();
  if (!spent || device.platform !== "ios" || config === null) throw new ApiError("attestation_failed");
  const { publicKey } = verifyAttestationObject({
    attestation: request.attestation,
    keyId: request.keyId,
    clientDataHash: sha256(Buffer.from(request.challenge)),
    appId: config.appId,
    environment: config.environment,
    at: trust.at,
    root: trust.root,
  });
  await saveAttestKey(device, request.keyId, publicKey);
}
