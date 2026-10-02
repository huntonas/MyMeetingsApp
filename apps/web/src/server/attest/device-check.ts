import { createPrivateKey, randomUUID, sign } from "node:crypto";

import { readEnv } from "@/env";
import type { AppAttestEnvironment } from "@/server/attest/app-attest";
import { appAttestConfig } from "@/server/attest/config";

const APPLE_HOSTS: Record<AppAttestEnvironment, string> = {
  production: "https://api.devicecheck.apple.com",
  development: "https://api.development.devicecheck.apple.com",
};
const TIMEOUT_MS = 10_000;

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

// Spec §6: an iPhone without App Attest proves it's a real Apple device running this team's app with a one-time
// DeviceCheck token, which only Apple can check. False when Apple refuses the token or no key is configured (a
// misconfiguration, warned); anything else from Apple throws, so the request is a server error rather than the phone's
// fault. Neither the token nor Apple's reply is ever logged.
export async function validDeviceCheckToken(token: string): Promise<boolean> {
  const config = appAttestConfig();
  const keyId = readEnv("DEVICECHECK_KEY_ID");
  const privateKey = readEnv("DEVICECHECK_PRIVATE_KEY");
  if (config === null || keyId === undefined || privateKey === undefined) {
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
  if (response.status === 200) return true;
  if (response.status === 400) return false;
  throw new Error(`DeviceCheck answered ${String(response.status)}`);
}
