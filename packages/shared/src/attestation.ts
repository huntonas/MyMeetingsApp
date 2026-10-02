import { z } from "zod";

// Spec §6: an iPhone proves a write came from the real app with an App Attest assertion, or, on an iPhone without App
// Attest, a DeviceCheck token. The phone builds X-Attestation and the server reads it here, so the two can't drift;
// the network audit holds the header to the same shape.
const BASE64 = "[A-Za-z0-9+/]+={0,2}";
// A key id is the base64 SHA-256 of the key: 43 characters and one "=".
const KEY_ID = "[A-Za-z0-9+/]{43}=";
const APP_ATTEST = new RegExp(`^appattest\\.v1\\.(${KEY_ID})\\.([0-9]{13})\\.(${BASE64})$`);
const DEVICE_CHECK = new RegExp(`^devicecheck\\.v1\\.(${BASE64})$`);

export type AttestationProof =
  | { kind: "appAttest"; keyId: string; timestamp: number; assertion: string }
  | { kind: "deviceCheck"; token: string };

export function appAttestHeader(keyId: string, timestamp: number, assertion: string): string {
  return `appattest.v1.${keyId}.${String(timestamp)}.${assertion}`;
}

export function deviceCheckHeader(token: string): string {
  return `devicecheck.v1.${token}`;
}

// null for anything that isn't exactly one of the two shapes.
export function parseAttestation(value: string): AttestationProof | null {
  const appAttest = APP_ATTEST.exec(value);
  if (appAttest !== null) {
    const [, keyId = "", timestamp = "", assertion = ""] = appAttest;
    return { kind: "appAttest", keyId, timestamp: Number(timestamp), assertion };
  }
  const deviceCheck = DEVICE_CHECK.exec(value);
  return deviceCheck === null ? null : { kind: "deviceCheck", token: deviceCheck[1] ?? "" };
}

// The text an App Attest assertion signs (its SHA-256 is the client data hash): the method and path, so it can't be
// replayed against another endpoint; the phone's clock, which the server holds to a day; and the exact body bytes.
export function assertionClientData(request: {
  method: string;
  path: string;
  timestamp: number;
  body: string;
}): string {
  return [
    // A protocol constant, not the brand: renaming the app must never change what a signature covers.
    "mymeetingapp write v1",
    request.method,
    request.path,
    String(request.timestamp),
    request.body,
  ].join("\n");
}

// 32 random bytes, base64url without padding.
const AttestChallenge = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const AttestChallengeResponse = z.object({ challenge: AttestChallenge });
export type AttestChallengeResponse = z.infer<typeof AttestChallengeResponse>;

// Apple's attestation object is about 6 KB; 16 KB matches the header limit in WriteHeaders.
export const AttestRegisterRequest = z.object({
  keyId: z.string().regex(new RegExp(`^${KEY_ID}$`)),
  attestation: z
    .string()
    .max(16_384)
    .regex(new RegExp(`^${BASE64}$`)),
  challenge: AttestChallenge,
});
export type AttestRegisterRequest = z.infer<typeof AttestRegisterRequest>;

export const AttestRegisterResponse = z.object({ registered: z.literal(true) });
export type AttestRegisterResponse = z.infer<typeof AttestRegisterResponse>;
