import { describe, expect, it } from "vitest";

import {
  appAttestHeader,
  assertionClientData,
  AttestChallengeResponse,
  AttestRegisterRequest,
  deviceCheckHeader,
  parseAttestation,
} from "../src/index";

// App Attest key ids are the base64 SHA-256 of the public key: 43 characters and one "=".
const KEY_ID = "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=";
const CHALLENGE = "q3Jw0F2nYc5yQ0d1Gk7mR8sT9uV0wX1yZ2aB3cD4eF5";

describe("the X-Attestation header", () => {
  it("carries an App Attest key id, the phone's clock and the assertion, and reads back the same", () => {
    const header = appAttestHeader(KEY_ID, 1791201600000, "omlzaWduYXR1cmU=");
    expect(header).toBe(`appattest.v1.${KEY_ID}.1791201600000.omlzaWduYXR1cmU=`);
    expect(parseAttestation(header)).toEqual({
      kind: "appAttest",
      keyId: KEY_ID,
      timestamp: 1791201600000,
      assertion: "omlzaWduYXR1cmU=",
    });
  });

  it("carries a DeviceCheck token on an iPhone without App Attest", () => {
    expect(parseAttestation(deviceCheckHeader("AgAAAAbcdef+/=="))).toEqual({
      kind: "deviceCheck",
      token: "AgAAAAbcdef+/==",
    });
  });

  it.each([
    ["no version", `appattest.${KEY_ID}.1791201600000.abc=`],
    ["a key id of the wrong length", "appattest.v1.abc=.1791201600000.abc="],
    ["a clock that isn't milliseconds", `appattest.v1.${KEY_ID}.1791201600.abc=`],
    ["a coordinate", `appattest.v1.${KEY_ID}.1791201600000.36.162749`],
    ["an unknown kind", "playintegrity.v1.abc="],
    ["nothing after the kind", "devicecheck.v1."],
  ])("reads nothing from a header with %s", (_why, value) => {
    expect(parseAttestation(value)).toBeNull();
  });
});

describe("what an assertion signs", () => {
  it("is the method, path, clock and exact body, one per line, after a version line", () => {
    expect(
      assertionClientData({
        method: "POST",
        path: "/api/v1/tags",
        timestamp: 1791201600000,
        body: '{"meetingId":"0f8fad5b-d9cb-469f-a165-70867728950e","tags":["quiet"]}',
      }),
    ).toBe(
      'mymeetingapp write v1\nPOST\n/api/v1/tags\n1791201600000\n{"meetingId":"0f8fad5b-d9cb-469f-a165-70867728950e","tags":["quiet"]}',
    );
  });

  it("ends with an empty line for a write with no body", () => {
    expect(
      assertionClientData({ method: "POST", path: "/api/v1/tags/delete-mine", timestamp: 1, body: "" }),
    ).toBe("mymeetingapp write v1\nPOST\n/api/v1/tags/delete-mine\n1\n");
  });
});

describe("the attest contracts", () => {
  it("accept a 32-byte base64url challenge only", () => {
    expect(AttestChallengeResponse.safeParse({ challenge: CHALLENGE }).success).toBe(true);
    expect(AttestChallengeResponse.safeParse({ challenge: `${CHALLENGE}=` }).success).toBe(false);
    expect(AttestChallengeResponse.safeParse({ challenge: "short" }).success).toBe(false);
  });

  it("accept a registration of a key id, a base64 attestation and the challenge", () => {
    const registration = { keyId: KEY_ID, attestation: "o2NmbXRvYXBwbGUtYXBwYXR0ZXN0", challenge: CHALLENGE };
    expect(AttestRegisterRequest.parse(registration)).toEqual(registration);
    expect(AttestRegisterRequest.safeParse({ ...registration, attestation: "not base64!" }).success).toBe(
      false,
    );
    expect(
      AttestRegisterRequest.safeParse({ ...registration, attestation: "A".repeat(16_388) }).success,
    ).toBe(false);
  });
});
