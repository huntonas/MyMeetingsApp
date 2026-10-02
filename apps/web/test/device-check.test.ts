import { generateKeyPairSync, verify } from "node:crypto";
import { format } from "node:util";

import { deviceCheckHeader, ERROR_MESSAGES } from "@mymeetingapp/shared";
import { startServer } from "@mymeetingapp/test-server";
import { z } from "zod";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as tagRoute } from "@/app/api/v1/tags/route";
import { pool } from "@/db/client";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { saveAttestKey } from "@/server/attest/keys";

import { stubAppAttest, testAttestKey } from "./attest-fixtures";
import { resetDb } from "./db";
import { DEVICE_A_HASH, deviceHeaders, seedMeetingStarted } from "./tag-fixtures";

const TOKEN = "AgAAAHRlc3QgZGV2aWNlIHRva2Vu";
// A real P-256 key standing in for the owner's .p8 (PKCS#8 PEM, as Apple issues it).
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const ValidateBody = z.strictObject({
  device_token: z.string(),
  transaction_id: z.uuid(),
  timestamp: z.number().int(),
});

let meetingId: string;
beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
  stubAppAttest();
  vi.stubEnv("DEVICECHECK_KEY_ID", "ABC123DEFG");
  vi.stubEnv("DEVICECHECK_PRIVATE_KEY", privateKey.export({ format: "pem", type: "pkcs8" }).toString());
  meetingId = await seedMeetingStarted(1);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => pool.end());

// Apple's validate endpoint, answering every request with `status`.
async function apple(status: number) {
  const server = await startServer(() => ({ status, body: status === 200 ? "" : "Bad Device Token" }));
  vi.stubEnv("DEVICECHECK_API_URL", server.baseUrl);
  return server;
}

function tag() {
  return tagRoute(
    new Request("http://test/api/v1/tags", {
      method: "POST",
      headers: {
        ...deviceHeaders(),
        "X-Attestation": deviceCheckHeader(TOKEN),
        "content-type": "application/json",
      },
      body: JSON.stringify({ meetingId, tags: ["quiet"] }),
    }),
  );
}

describe("a write from an iPhone without App Attest", () => {
  it("is accepted when Apple accepts its DeviceCheck token, asked with a provider token signed by our key", async () => {
    const server = await apple(200);
    expect((await tag()).status).toBe(201);
    const [request] = server.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/v1/validate_device_token");
    expect(ValidateBody.parse(JSON.parse(request?.body ?? "")).device_token).toBe(TOKEN);
    const [header = "", claims = "", signature = ""] = (request?.headers.authorization ?? "")
      .replace(/^Bearer /, "")
      .split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "ABC123DEFG",
    });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({ iss: "PVCZBLDJ73" });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
    await server.close();
  });

  it("is refused when Apple refuses the token", async () => {
    const server = await apple(400);
    const res = await tag();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "attestation_failed", message: ERROR_MESSAGES.attestation_failed },
    });
    await server.close();
  });

  it("answers server_error and logs only the status when Apple's DeviceCheck fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = await apple(503);
    const res = await tag();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "server_error" } });
    const logged = error.mock.calls.map((args) => format(...args)).join("\n");
    expect(logged).toContain("DeviceCheck answered 503");
    expect(logged).not.toContain(TOKEN);
    await server.close();
  });

  it("is refused, without asking Apple, from a phone that registered an App Attest key", async () => {
    const key = testAttestKey();
    await saveAttestKey({ platform: "ios", deviceHash: DEVICE_A_HASH }, key.keyId, key.publicKey);
    const server = await apple(200);
    expect((await tag()).status).toBe(401);
    expect(server.requests).toEqual([]);
    await server.close();
  });

  it("is refused, with a warning, while the DeviceCheck key isn't configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("DEVICECHECK_PRIVATE_KEY", undefined);
    const server = await apple(200);
    expect((await tag()).status).toBe(401);
    expect(server.requests).toEqual([]);
    expect(warn.mock.calls.map((args) => format(...args)).join("\n")).toContain(
      "DEVICECHECK_KEY_ID and DEVICECHECK_PRIVATE_KEY must be set",
    );
    await server.close();
  });
});
