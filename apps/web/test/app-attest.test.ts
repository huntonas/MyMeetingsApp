import { X509Certificate } from "node:crypto";

import { decode } from "cborg";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/respond";
import { APPLE_APP_ATTESTATION_ROOT_CA } from "@/server/attest/apple-root";
import { sha256, verifyAssertion, verifyAttestationObject } from "@/server/attest/app-attest";

import { APPLE_SAMPLE_ATTESTATION } from "./apple-attestation-sample";
import { APP_ID, FORGED_VALID_AT, forgedAttestation, testAttestKey } from "./attest-fixtures";

// Apple's sample (apple-attestation-sample.ts), checked while its leaf certificate was valid.
const SAMPLE = {
  attestation: APPLE_SAMPLE_ATTESTATION,
  keyId: "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=",
  clientDataHash: Buffer.from("example_server_challenge"),
  appId: "1234567890.com.example.myapp",
  environment: "production" as const,
  at: new Date("2026-04-21T12:00:00Z"),
};

// What a check ends in: "accepted", the ApiError's code, or "another error" (a bug: Apple's bytes must never crash it).
function outcome(check: () => unknown): string {
  try {
    check();
    return "accepted";
  } catch (error) {
    return error instanceof ApiError ? error.code : "another error";
  }
}

describe("verifyAttestationObject", () => {
  it("accepts Apple's sample and returns the attested public key", () => {
    expect(verifyAttestationObject(SAMPLE)).toEqual({
      publicKey:
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEQzJUSs8yPbd0RDyq8zn1bn6VxyT6wsFCWfNl4kRWULK1+yhbz1Sby2BZRBLnaCokJ+6tqftS3+0LGrF+0J+pvQ==",
    });
  });

  it.each([
    ["after its leaf certificate expired", { at: new Date("2026-10-02T12:00:00Z") }],
    ["for another app", { appId: "1234567890.com.example.other" }],
    ["over another challenge", { clientDataHash: sha256(Buffer.from("example_server_challenge")) }],
    ["for another key id", { keyId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }],
    ["from the production environment when development is expected", { environment: "development" as const }],
    ["that isn't CBOR", { attestation: "bm90IGNib3I=" }],
    ["that isn't base64 at all", { attestation: "%%%" }],
  ])("refuses an attestation %s", (_why, change) => {
    expect(outcome(() => verifyAttestationObject({ ...SAMPLE, ...change }))).toBe("attestation_failed");
  });

  // A forged chain, otherwise right in every check, so each test fails only if the chain itself goes unchecked.
  const forged = (intermediate?: Uint8Array) => {
    const { attestation, keyId } = forgedAttestation(SAMPLE.clientDataHash, intermediate);
    return () =>
      verifyAttestationObject({ ...SAMPLE, attestation, keyId, appId: APP_ID, at: FORGED_VALID_AT });
  };

  it("refuses an attestation whose chain ends at a root other than Apple's", () => {
    expect(outcome(forged())).toBe("attestation_failed");
  });

  it("refuses an attestation whose leaf Apple's intermediate didn't sign", () => {
    const sample = decode(Buffer.from(APPLE_SAMPLE_ATTESTATION, "base64")) as {
      attStmt: { x5c: Uint8Array[] };
    };
    expect(outcome(forged(sample.attStmt.x5c[1]))).toBe("attestation_failed");
  });

  it("pins Apple's App Attestation root by its SHA-256 fingerprint", () => {
    expect(new X509Certificate(APPLE_APP_ATTESTATION_ROOT_CA).fingerprint256).toBe(
      "1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32",
    );
  });
});

describe("verifyAssertion", () => {
  const key = testAttestKey();
  const check = (assertion: string, change: { clientData?: string; storedCounter?: number } = {}) =>
    verifyAssertion({
      assertion,
      clientData: "signed text",
      publicKey: key.publicKey,
      appId: APP_ID,
      storedCounter: 0,
      ...change,
    });

  it("returns the counter of an assertion signed by the registered key over the same text", () => {
    expect(check(key.assert(1, "signed text"))).toBe(1);
  });

  it("refuses an assertion whose counter isn't above the last one", () => {
    expect(outcome(() => check(key.assert(5, "signed text"), { storedCounter: 5 }))).toBe(
      "attestation_failed",
    );
  });

  it("refuses an assertion over different text", () => {
    expect(outcome(() => check(key.assert(1, "signed text"), { clientData: "other text" }))).toBe(
      "attestation_failed",
    );
  });

  it("refuses an assertion made for another app", () => {
    expect(outcome(() => check(key.assert(1, "signed text", "1234567890.com.example.myapp")))).toBe(
      "attestation_failed",
    );
  });

  it("refuses an assertion signed by another key", () => {
    expect(outcome(() => check(testAttestKey().assert(1, "signed text")))).toBe("attestation_failed");
  });

  it("refuses an assertion that isn't CBOR", () => {
    expect(outcome(() => check("bm90IGNib3I="))).toBe("attestation_failed");
  });
});
