import { createHash, verify, X509Certificate } from "node:crypto";

import { Constructed, fromBER, ObjectIdentifier, OctetString } from "asn1js";
import { decode, decodeFirst } from "cborg";
import { z } from "zod";

import { ApiError } from "@/lib/api/respond";

export type AppAttestEnvironment = "production" | "development";

// The leaf certificate's extension holding the nonce Apple signed.
const NONCE_EXTENSION = "1.2.840.113635.100.8.2";
// Apple's validation steps name "appattestdevelop" for development; its sandbox guide names "appattestsandbox".
const AAGUIDS: Record<AppAttestEnvironment, readonly Buffer[]> = {
  production: [Buffer.concat([Buffer.from("appattest"), Buffer.alloc(7)])],
  development: [Buffer.from("appattestdevelop"), Buffer.from("appattestsandbox")],
};

const Bytes = z.instanceof(Uint8Array);
const AttestationObject = z.object({
  fmt: z.literal("apple-appattest"),
  attStmt: z.object({ x5c: z.tuple([Bytes, Bytes]), receipt: Bytes }),
  authData: Bytes,
});
const AssertionObject = z.object({ signature: Bytes, authenticatorData: Bytes });

function fail(): never {
  throw new ApiError("attestation_failed");
}

export function sha256(...parts: Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function children(node: unknown): unknown[] {
  return node instanceof Constructed ? node.valueBlock.value : [];
}

// The octet string inside the leaf's nonce extension: Certificate → tbsCertificate → [3] extensions → the one whose id
// is NONCE_EXTENSION → its value, a SEQUENCE holding [1] OCTET STRING.
function certificateNonce(certificate: X509Certificate): Buffer | null {
  const [tbs] = children(fromBER(certificate.raw).result);
  const wrapper = children(tbs).find(
    (node) => node instanceof Constructed && node.idBlock.tagClass === 3 && node.idBlock.tagNumber === 3,
  );
  for (const extension of children(children(wrapper)[0])) {
    const [id, ...rest] = children(extension);
    const value = rest.at(-1);
    if (!(id instanceof ObjectIdentifier) || id.valueBlock.toString() !== NONCE_EXTENSION) continue;
    if (!(value instanceof OctetString)) return null;
    const [nonce] = children(children(fromBER(value.valueBlock.valueHexView).result)[0]);
    return nonce instanceof OctetString ? Buffer.from(nonce.valueBlock.valueHexView) : null;
  }
  return null;
}

// Authenticator data with an attested credential: rpIdHash (32) ‖ flags (1) ‖ counter (4) ‖ aaguid (16) ‖ id length
// (2) ‖ credential id ‖ the COSE key (CBOR, integer keys) ‖ Apple's extensions map, which recent iOS appends even with
// the ED flag clear. The extensions are checked only for being well-formed (decision 9).
function attestedAuthData(bytes: Uint8Array) {
  const data = Buffer.from(bytes);
  if (data.length < 55) fail();
  const idLength = data.readUInt16BE(53);
  if (data.length < 55 + idLength) fail();
  const [, extensions] = decodeFirst(data.subarray(55 + idLength), { useMaps: true });
  if (extensions.length > 0) decode(extensions, { useMaps: true });
  return {
    rpIdHash: data.subarray(0, 32),
    counter: data.readUInt32BE(33),
    aaguid: data.subarray(37, 53),
    credentialId: data.subarray(55, 55 + idLength),
  };
}

function validAt(certificate: X509Certificate, at: Date): boolean {
  return certificate.validFromDate <= at && at <= certificate.validToDate;
}

// Anything unexpected in Apple's bytes (bad CBOR, a certificate that won't parse) is a failed check, not a server error.
function refuseOnError<T>(check: () => T): T {
  try {
    return check();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return fail();
  }
}

// Apple's attestation steps, in its order. `clientDataHash` is what the phone passed to attestKey (the route passes
// SHA-256 of the challenge, as modules/app-integrity makes it); `at` is the moment the certificates must be valid, and
// `root` the certificate the chain must end at (register.ts passes APPLE_APP_ATTESTATION_ROOT; tests pass their own).
export function verifyAttestationObject(input: {
  attestation: string;
  keyId: string;
  clientDataHash: Uint8Array;
  appId: string;
  environment: AppAttestEnvironment;
  at: Date;
  root: X509Certificate;
}): { publicKey: string } {
  return refuseOnError(() => {
    const object = AttestationObject.parse(decode(Buffer.from(input.attestation, "base64")));
    const [leafBytes, intermediateBytes] = object.attStmt.x5c;
    const leaf = new X509Certificate(leafBytes);
    const intermediate = new X509Certificate(intermediateBytes);
    if (!intermediate.verify(input.root.publicKey) || !leaf.verify(intermediate.publicKey)) fail();
    if (![leaf, intermediate, input.root].every((certificate) => validAt(certificate, input.at))) fail();
    const nonce = certificateNonce(leaf);
    if (nonce?.equals(sha256(object.authData, input.clientDataHash)) !== true) fail();
    // App Attest keys are P-256, and the key id is the SHA-256 of the raw (X9.62 uncompressed) point: the last 65 bytes
    // of a P-256 SPKI.
    if (leaf.publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") fail();
    const publicKey = leaf.publicKey.export({ format: "der", type: "spki" });
    const keyId = Buffer.from(input.keyId, "base64");
    if (!sha256(publicKey.subarray(-65)).equals(keyId)) fail();
    const authData = attestedAuthData(object.authData);
    if (!authData.rpIdHash.equals(sha256(Buffer.from(input.appId)))) fail();
    if (authData.counter !== 0) fail();
    if (!AAGUIDS[input.environment].some((aaguid) => aaguid.equals(authData.aaguid))) fail();
    if (!authData.credentialId.equals(keyId)) fail();
    return { publicKey: publicKey.toString("base64") };
  });
}

// Apple's assertion steps. The caller stores the returned counter, so the next assertion must exceed it.
export function verifyAssertion(input: {
  assertion: string;
  clientData: string;
  publicKey: string;
  appId: string;
  storedCounter: number;
}): number {
  return refuseOnError(() => {
    const object = AssertionObject.parse(decode(Buffer.from(input.assertion, "base64")));
    const authData = Buffer.from(object.authenticatorData);
    if (authData.length < 37) fail();
    const nonce = sha256(authData, sha256(Buffer.from(input.clientData)));
    const key = { key: Buffer.from(input.publicKey, "base64"), format: "der", type: "spki" } as const;
    if (!verify("sha256", nonce, key, object.signature)) fail();
    if (!authData.subarray(0, 32).equals(sha256(Buffer.from(input.appId)))) fail();
    const counter = authData.readUInt32BE(33);
    if (counter <= input.storedCounter) fail();
    return counter;
  });
}
