import type { AttestRegisterRequest } from "@mymeetingapp/shared";

import { ApiError } from "@/lib/api/respond";
import { sha256, verifyAttestationObject } from "@/server/attest/app-attest";
import { APPLE_APP_ATTESTATION_ROOT } from "@/server/attest/apple-root";
import { spendChallenge } from "@/server/attest/challenges";
import { appAttestConfig } from "@/server/attest/config";
import { saveAttestKey } from "@/server/attest/keys";
import type { WriteDevice } from "@/server/devices/write-request";

// Spec §6: verifies an iPhone's attestation against Apple's root and stores its key. The challenge is spent first, so
// it's gone whatever happens next. modules/app-integrity hands Apple SHA-256 of the challenge's text as the client data
// hash.
export async function registerAppAttestKey(
  device: WriteDevice,
  request: AttestRegisterRequest,
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
    at: new Date(),
    root: APPLE_APP_ATTESTATION_ROOT,
  });
  await saveAttestKey(device, request.keyId, publicKey);
}
