import { createPrivateKey, randomUUID, sign } from "node:crypto";

import type { Executor } from "@/db/client";
import { deviceCheckTokens } from "@/db/schema";
import { readEnv } from "@/env";
import { ApiError } from "@/lib/api/respond";
import { type AppAttestEnvironment, sha256 } from "@/server/attest/app-attest";
import { appAttestConfig } from "@/server/attest/config";

const APPLE_HOSTS: Record<AppAttestEnvironment, string> = {
  production: "https://api.devicecheck.apple.com",
  development: "https://api.development.devicecheck.apple.com",
};
const TIMEOUT_MS = 10_000;
// Apple's 400 replies, by the words each one's text uses (its documentation names them Bad Device Token, Bad
// Authorization Token, Bad Timestamp and Bad Payload). The device token's text says "payload" too, so it comes first.
const BAD_REQUEST_REASONS = [
  ["device token", "bad device token"],
  ["authorization", "bad authorization token"],
  ["timestamp", "bad timestamp"],
  ["payload", "bad payload"],
] as const;

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

// Apple's provider token, as for APNs: ES256 over {alg, kid} and {iss: team id, iat}, signed with the DeviceCheck key.
function providerToken(privateKey: string, keyId: string, teamId: string): string {
  const unsigned = `${base64url(JSON.stringify({ alg: "ES256", kid: keyId }))}.${base64url(
    JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }),
  )}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: createPrivateKey(privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${unsigned}.${base64url(signature)}`;
}

// Which of Apple's 400s this is, as one of the fixed names above: Apple's own text is never logged.
function badRequestReason(text: string): string {
  const lower = text.toLowerCase();
  return BAD_REQUEST_REASONS.find(([words]) => lower.includes(words))?.[1] ?? "an unrecognised reason";
}

// Spec §6: an iPhone without App Attest proves it's a real Apple device running this team's app with a DeviceCheck
// token, which only Apple can check (and which spendDeviceCheckToken makes work once). False when Apple says the
// device token is bad, or no key is configured (a misconfiguration, warned; appAttestConfig warns about the App ID
// itself). Anything else from Apple is our side's fault or Apple's, never the phone's, so it throws and the request is
// a server error; a 400 that blames our request is also warned by its fixed name. Neither the token nor Apple's reply
// is ever logged, and the reply's body is read or cancelled on every path.
export async function validDeviceCheckToken(token: string): Promise<boolean> {
  const config = appAttestConfig();
  if (config === null) return false;
  const keyId = readEnv("DEVICECHECK_KEY_ID");
  const privateKey = readEnv("DEVICECHECK_PRIVATE_KEY");
  if (keyId === undefined || privateKey === undefined) {
    console.warn(
      "[attestation] DEVICECHECK_KEY_ID and DEVICECHECK_PRIVATE_KEY must be set; refusing DeviceCheck tokens",
    );
    return false;
  }
  const host = readEnv("DEVICECHECK_API_URL") ?? APPLE_HOSTS[config.environment];
  const response = await fetch(`${host}/v1/validate_device_token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerToken(privateKey, keyId, config.teamId)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ device_token: token, transaction_id: randomUUID(), timestamp: Date.now() }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status !== 400) {
    await response.body?.cancel();
    if (response.status === 200) return true;
    throw new Error(`DeviceCheck answered ${String(response.status)}`);
  }
  const reason = badRequestReason(await response.text());
  if (reason === "bad device token") return false;
  console.warn(`[attestation] DeviceCheck refused our own request: ${reason}`);
  throw new Error("DeviceCheck answered 400");
}

// Spec §6: a DeviceCheck token works once. Its SHA-256 is kept, linked to nothing, in the write's own transaction
// after Apple accepted it, so a write the server then refuses doesn't spend it. Of two writes with one token, the
// second waits on the first's uncommitted row, then finds it and is refused.
export async function spendDeviceCheckToken(token: string, tx: Executor): Promise<void> {
  const spent = await tx
    .insert(deviceCheckTokens)
    .values({ tokenHash: sha256(Buffer.from(token)).toString("hex") })
    .onConflictDoNothing()
    .returning({ tokenHash: deviceCheckTokens.tokenHash });
  if (spent.length === 0) throw new ApiError("attestation_failed");
}
