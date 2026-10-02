import { decode } from "cborg";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/respond";
import { APPLE_APP_ATTESTATION_ROOT } from "@/server/attest/apple-root";
import { sha256, verifyAssertion, verifyAttestationObject } from "@/server/attest/app-attest";

import { APPLE_SAMPLE_ATTESTATION } from "./apple-attestation-sample";
import { APP_ID, FORGED_VALID_AT, type Forgery, forgedAttestation, testAttestKey } from "./attest-fixtures";

// Apple's sample (apple-attestation-sample.ts), checked while its leaf certificate was valid.
const SAMPLE = {
  attestation: APPLE_SAMPLE_ATTESTATION,
  keyId: "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=",
  clientDataHash: Buffer.from("example_server_challenge"),
  appId: "1234567890.com.example.myapp",
  environment: "production" as const,
  at: new Date("2026-04-21T12:00:00Z"),
  root: APPLE_APP_ATTESTATION_ROOT,
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
    ["before its leaf certificate was valid", { at: new Date("2026-04-19T12:00:00Z") }],
    ["for another app", { appId: "1234567890.com.example.other" }],
    ["over another challenge", { clientDataHash: sha256(Buffer.from("example_server_challenge")) }],
    ["for another key id", { keyId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }],
    ["from the production environment when development is expected", { environment: "development" as const }],
    ["that isn't CBOR", { attestation: "bm90IGNib3I=" }],
    ["that isn't base64 at all", { attestation: "%%%" }],
  ])("refuses an attestation %s", (_why, change) => {
    expect(outcome(() => verifyAttestationObject({ ...SAMPLE, ...change }))).toBe("attestation_failed");
  });

  // A forged attestation checked under its own root, or under `root` when given (Apple's, say).
  const forged = (forgery: Forgery = {}, root?: typeof APPLE_APP_ATTESTATION_ROOT) => {
    const made = forgedAttestation(SAMPLE.clientDataHash, forgery);
    const check = () =>
      verifyAttestationObject({
        ...SAMPLE,
        attestation: made.attestation,
        keyId: made.keyId,
        appId: APP_ID,
        at: FORGED_VALID_AT,
        root: root ?? made.root,
      });
    return { check, publicKey: made.publicKey };
  };

  it("accepts a forged attestation under its own root, so each refusal below fails on its one change", () => {
    const { check, publicKey } = forged();
    expect(check()).toEqual({ publicKey });
  });

  it("refuses an attestation whose chain ends at a root other than Apple's", () => {
    expect(outcome(forged({}, APPLE_APP_ATTESTATION_ROOT).check)).toBe("attestation_failed");
  });

  it("refuses an attestation whose leaf Apple's intermediate didn't sign", () => {
    const sample = decode(Buffer.from(APPLE_SAMPLE_ATTESTATION, "base64")) as {
      attStmt: { x5c: Uint8Array[] };
    };
    const intermediate = sample.attStmt.x5c[1];
    expect(outcome(forged({ intermediate }, APPLE_APP_ATTESTATION_ROOT).check)).toBe("attestation_failed");
  });

  it.each<[string, Forgery]>([
    ["whose counter isn't 0", { counter: 1 }],
    ["whose credential id isn't its key id", { credentialId: Buffer.alloc(32, 7) }],
    ["whose key id isn't the SHA-256 of its leaf's key", { keyId: Buffer.alloc(32, 7) }],
    ["whose leaf key isn't P-256", { curve: "P-384" }],
    ["with three certificates in x5c", { withRoot: true }],
  ])("refuses an attestation %s", (_why, forgery) => {
    expect(outcome(forged(forgery).check)).toBe("attestation_failed");
  });

  it("pins Apple's App Attestation root by its SHA-256 fingerprint", () => {
    expect(APPLE_APP_ATTESTATION_ROOT.fingerprint256).toBe(
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
