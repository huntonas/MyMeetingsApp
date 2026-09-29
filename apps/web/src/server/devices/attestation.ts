import type { Platform } from "@mymeetingapp/shared";

import { readEnv } from "@/env";
import { ApiError } from "@/lib/api/respond";

interface AttestedRequest {
  platform: Platform;
  deviceHash: string;
  attestation: string | undefined;
}

// Spec §6: verification sits behind REQUIRE_ATTESTATION so development works without it. Only "off" (or unset)
// turns it off, so a mistyped value fails closed.
function attestationRequired(): boolean {
  const value = readEnv("REQUIRE_ATTESTATION")?.toLowerCase();
  if (value === undefined || value === "off") return false;
  if (value !== "on") console.warn('[attestation] REQUIRE_ATTESTATION should be "on" or "off"; requiring it');
  return true;
}

// The seam for the App Attest and Play Integrity verifiers. No platform verifier is configured, so while
// attestation is required nothing passes.
export function verifyAttestation(_request: AttestedRequest): void {
  if (attestationRequired()) throw new ApiError("attestation_failed");
}
