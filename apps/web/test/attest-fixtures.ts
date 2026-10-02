import { createHash, generateKeyPairSync, type KeyObject, sign, X509Certificate } from "node:crypto";

import {
  BitString,
  Constructed,
  fromBER,
  Integer,
  ObjectIdentifier,
  OctetString,
  Sequence,
  Set as AsnSet,
  UTCTime,
  Utf8String,
} from "asn1js";
import { encode } from "cborg";

// The app's App ID as App Attest names it: team id, a period, the bundle identifier.
export const APP_ID = "PVCZBLDJ73.com.goodersoftware.mymeetingapp";

const sha256 = (...parts: Uint8Array[]) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
};

export interface TestAttestKey {
  keyId: string;
  publicKey: string;
  // An assertion as a phone's Secure Enclave makes one: authenticator data (the App ID's hash, flags, the counter) and
  // an ECDSA signature over SHA-256(authenticatorData ‖ SHA-256(clientData)), CBOR-encoded, base64.
  assert(counter: number, clientData: string, appId?: string): string;
}

// A real P-256 key, standing in for one an iPhone made and Apple attested: tests store its public key as a
// registration would, then sign with it.
export function testAttestKey(): TestAttestKey {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ format: "der", type: "spki" });
  return {
    keyId: sha256(spki.subarray(-65)).toString("base64"),
    publicKey: spki.toString("base64"),
    assert(counter, clientData, appId = APP_ID) {
      const authenticatorData = Buffer.alloc(37);
      sha256(Buffer.from(appId)).copy(authenticatorData, 0);
      authenticatorData.writeUInt8(0x40, 32);
      authenticatorData.writeUInt32BE(counter, 33);
      const nonce = sha256(authenticatorData, sha256(Buffer.from(clientData)));
      const signature = sign("sha256", nonce, privateKey);
      return Buffer.from(encode({ signature, authenticatorData })).toString("base64");
    },
  };
}

const oid = (id: string) => new ObjectIdentifier({ value: id });
const explicit = (tagNumber: number, inner: Constructed | Integer | OctetString) =>
  new Constructed({ idBlock: { tagClass: 3, tagNumber }, value: [inner] });
const ecdsaWithSha256 = () => new Sequence({ value: [oid("1.2.840.10045.4.3.2")] });
const commonName = (name: string) =>
  new Sequence({
    value: [
      new AsnSet({ value: [new Sequence({ value: [oid("2.5.4.3"), new Utf8String({ value: name })] })] }),
    ],
  });

const DAY_MS = 86_400_000;

// A minimal X.509 v3 certificate for `subject`, signed by `issuerKey`, valid from a day ago to a year from now, with Apple's nonce extension
// when `nonce` is given.
function certificate(subject: KeyObject, issuerKey: KeyObject, nonce?: Buffer): Buffer {
  const extensions = nonce
    ? [
        explicit(
          3,
          new Sequence({
            value: [
              new Sequence({
                value: [
                  oid("1.2.840.113635.100.8.2"),
                  new OctetString({
                    valueHex: new Sequence({
                      value: [explicit(1, new OctetString({ valueHex: nonce }))],
                    }).toBER(),
                  }),
                ],
              }),
            ],
          }),
        ),
      ]
    : [];
  const tbs = new Sequence({
    value: [
      explicit(0, new Integer({ value: 2 })),
      new Integer({ value: 1 }),
      ecdsaWithSha256(),
      commonName("Forged"),
      new Sequence({
        value: [
          new UTCTime({ valueDate: new Date(Date.now() - DAY_MS) }),
          new UTCTime({ valueDate: new Date(Date.now() + 365 * DAY_MS) }),
        ],
      }),
      commonName("Forged"),
      fromBER(subject.export({ format: "der", type: "spki" })).result,
      ...extensions,
    ],
  });
  const signature = sign("sha256", Buffer.from(tbs.toBER()), issuerKey);
  return Buffer.from(
    new Sequence({ value: [tbs, ecdsaWithSha256(), new BitString({ valueHex: signature })] }).toBER(),
  );
}

// What a test may change in a forged attestation; each is one of Apple's checks made to fail.
export interface Forgery {
  counter?: number;
  // The credential id in authData (by default the key id).
  credentialId?: Buffer;
  // The key id the attestation claims, both as input and credential id (by default the SHA-256 of the leaf's point).
  keyId?: Buffer;
  curve?: "P-256" | "P-384";
  // Put in x5c in place of the made-up intermediate, as if the forger claimed a real one signed their leaf.
  intermediate?: Uint8Array;
  // Appends the root itself to x5c, making three certificates.
  withRoot?: boolean;
}

// An attestation as Apple's would be for APP_ID in production (counter 0, the key id as credential id, the nonce in
// the leaf), but its leaf is signed by a made-up intermediate under a made-up `root`. Under that root it passes every
// check, so a test changing one thing (`forgery`) fails on that thing alone.
export function forgedAttestation(
  clientDataHash: Uint8Array,
  forgery: Forgery = {},
): { attestation: string; keyId: string; publicKey: string; root: X509Certificate } {
  const ec = (namedCurve = "P-256") => generateKeyPairSync("ec", { namedCurve });
  const [root, middle, leaf] = [ec(), ec(), ec(forgery.curve)];
  const spki = leaf.publicKey.export({ format: "der", type: "spki" });
  // As the verifier reads it: the SHA-256 of the last 65 bytes of the SPKI, a P-256 key's uncompressed point.
  const keyId = forgery.keyId ?? sha256(spki.subarray(-65));
  const credentialId = forgery.credentialId ?? keyId;
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(forgery.counter ?? 0);
  const authData = Buffer.concat([
    sha256(Buffer.from(APP_ID)),
    Buffer.from([0x40]),
    counter,
    Buffer.from("appattest"),
    Buffer.alloc(7),
    Buffer.from([0, credentialId.length]),
    credentialId,
    encode(new Map([[1, 2]])),
  ]);
  const rootCertificate = certificate(root.publicKey, root.privateKey);
  const x5c = [
    certificate(leaf.publicKey, middle.privateKey, sha256(authData, clientDataHash)),
    forgery.intermediate ?? certificate(middle.publicKey, root.privateKey),
    ...(forgery.withRoot === true ? [rootCertificate] : []),
  ];
  const attestation = encode({
    fmt: "apple-appattest",
    attStmt: { x5c, receipt: Buffer.alloc(0) },
    authData,
  });
  return {
    attestation: Buffer.from(attestation).toString("base64"),
    keyId: keyId.toString("base64"),
    publicKey: spki.toString("base64"),
    root: new X509Certificate(rootCertificate),
  };
}
