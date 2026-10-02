// The local module @modules/app-integrity, as App Attest and DeviceCheck answer the app. A test says what this phone
// supports and how Apple answers. Keys and proofs are readable base64 strings, and every signed text is recorded.
type Support = "appAttest" | "deviceCheck" | "none";

// "none" by default, as on the simulator: tests that aren't about app checks see the writes they always saw.
let support: Support = "none";
let keysMade = 0;
let tokensMade = 0;
let attestTrouble: "none" | "unavailable" = "none";
const staleKeys = new Set<string>();
// Each text an assertion signed, oldest first.
export const signedClientData: string[] = [];
// Each challenge a key was attested over, oldest first.
export const attestedChallenges: string[] = [];

// The nth key this phone makes: 32 bytes of n, base64, shaped like Apple's key ids.
export const keyIdFor = (n: number) => Buffer.alloc(32, n).toString("base64");

export function setIntegrity(next: Support): void {
  support = next;
}
// "unavailable": Apple's attestation server can't be reached (DCError.serverUnavailable).
export function setAttestTrouble(next: typeof attestTrouble): void {
  attestTrouble = next;
}
// The key is gone from the Secure Enclave, as after a reinstall: assertions with it fail as DCError.invalidKey does.
export function makeKeyStale(keyId: string): void {
  staleKeys.add(keyId);
}
export function resetIntegrity(): void {
  support = "none";
  keysMade = 0;
  tokensMade = 0;
  attestTrouble = "none";
  staleKeys.clear();
  signedClientData.length = 0;
  attestedChallenges.length = 0;
}

const failure = (code: string) => Object.assign(new Error(`[AppIntegrity] ${code}`), { code });

export default {
  get isAppAttestSupported(): boolean {
    return support === "appAttest";
  },
  get isDeviceCheckSupported(): boolean {
    return support !== "none";
  },
  generateKey(): Promise<string> {
    keysMade += 1;
    return Promise.resolve(keyIdFor(keysMade));
  },
  attestKey(keyId: string, challenge: string): Promise<string> {
    attestedChallenges.push(challenge);
    if (attestTrouble === "unavailable") return Promise.reject(failure("ERR_APP_INTEGRITY"));
    return Promise.resolve(Buffer.from(`attestation of ${keyId}`).toString("base64"));
  },
  generateAssertion(keyId: string, clientData: string): Promise<string> {
    if (staleKeys.has(keyId)) return Promise.reject(failure("ERR_INVALID_KEY"));
    signedClientData.push(clientData);
    return Promise.resolve(Buffer.from(`assertion ${String(signedClientData.length)}`).toString("base64"));
  },
  // Numbered, as Apple's tokens are each different: the server takes each one once.
  deviceCheckToken(): Promise<string> {
    tokensMade += 1;
    return Promise.resolve(Buffer.from(`device check token ${String(tokensMade)}`).toString("base64"));
  },
};
