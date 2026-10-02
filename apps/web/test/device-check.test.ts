import { createHash, generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { format } from "node:util";

import { deviceCheckHeader, ERROR_MESSAGES } from "@mymeetingapp/shared";
import { startServer } from "@mymeetingapp/test-server";
import { z } from "zod";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as tagRoute } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { deviceCheckTokens, devices } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { saveAttestKey } from "@/server/attest/keys";

import { stubAppAttest, testAttestKey } from "./attest-fixtures";
import { resetDb, untilWaitingOnLock, whileHolding } from "./db";
import { DEVICE_A, DEVICE_A_HASH, DEVICE_B, deviceHeaders, seedMeetingStarted } from "./tag-fixtures";

const TOKEN = "AgAAAHRlc3QgZGV2aWNlIHRva2Vu";
// Apple's own reply texts for a 400 (developer.apple.com/forums/thread/95888 shows the live wording).
const BAD_DEVICE_TOKEN = "Missing or incorrectly formatted device token payload";
const BAD_AUTHORIZATION = "Missing or badly formatted authorization token";
// A real P-256 key standing in for the owner's .p8 (PKCS#8 PEM, as Apple issues it).
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const ValidateBody = z.strictObject({
  device_token: z.string(),
  transaction_id: z.uuid(),
  timestamp: z.number().int(),
});
const refusal = { error: { code: "attestation_failed", message: ERROR_MESSAGES.attestation_failed } };

let meetingId: string;
let server: Awaited<ReturnType<typeof startServer>> | undefined;
beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
  stubAppAttest();
  vi.stubEnv("DEVICECHECK_KEY_ID", "ABC123DEFG");
  vi.stubEnv("DEVICECHECK_PRIVATE_KEY", privateKey.export({ format: "pem", type: "pkcs8" }).toString());
  meetingId = await seedMeetingStarted(1);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await server?.close();
  server = undefined;
});
afterAll(() => pool.end());

// Apple's validate endpoint, answering every request with `status` and `body`.
async function apple(status: number, body = status === 200 ? "" : BAD_DEVICE_TOKEN) {
  const started = await startServer(() => ({ status, body }));
  server = started;
  vi.stubEnv("DEVICECHECK_API_URL", started.baseUrl);
  return started;
}

function tag({ device = DEVICE_A, meeting = meetingId }: { device?: string; meeting?: string } = {}) {
  return tagRoute(
    new Request("http://test/api/v1/tags", {
      method: "POST",
      headers: {
        ...deviceHeaders(device),
        "X-Attestation": deviceCheckHeader(TOKEN),
        "content-type": "application/json",
      },
      body: JSON.stringify({ meetingId: meeting, tags: ["quiet"] }),
    }),
  );
}

function logged(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((args) => format(...args)).join("\n");
}

describe("a write from an iPhone without App Attest", () => {
  it("is accepted when Apple accepts its DeviceCheck token, asked with a provider token signed by our key", async () => {
    const apple200 = await apple(200);
    expect((await tag()).status).toBe(201);
    const [request] = apple200.requests;
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
  });

  it("is accepted from a phone whose record holds no App Attest key", async () => {
    await db.insert(devices).values({ deviceHash: DEVICE_A_HASH, platform: "ios" });
    await apple(200);
    expect((await tag()).status).toBe(201);
  });

  it("is refused when Apple says the device token is bad", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await apple(400, BAD_DEVICE_TOKEN);
    const res = await tag();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(refusal);
    expect(logged(warn)).toBe("");
  });

  it("answers server_error, with a fixed warning, when Apple's 400 blames our authorization token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await apple(400, BAD_AUTHORIZATION);
    const res = await tag();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "server_error" } });
    expect(logged(warn)).toContain("DeviceCheck refused our own request: bad authorization token");
    const everything = `${logged(warn)}\n${logged(error)}`;
    expect(everything).not.toContain(BAD_AUTHORIZATION);
    expect(everything).not.toContain(TOKEN);
  });

  it("answers server_error and logs only the status when Apple's DeviceCheck fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await apple(503);
    const res = await tag();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "server_error" } });
    expect(logged(error)).toContain("DeviceCheck answered 503");
    expect(logged(error)).not.toContain(TOKEN);
  });

  it("is refused, without asking Apple, from a phone that registered an App Attest key", async () => {
    const key = testAttestKey();
    await saveAttestKey({ platform: "ios", deviceHash: DEVICE_A_HASH }, key.keyId, key.publicKey);
    const apple200 = await apple(200);
    expect((await tag()).status).toBe(401);
    expect(apple200.requests).toEqual([]);
  });

  it("is refused, with a warning, while the DeviceCheck key isn't configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("DEVICECHECK_PRIVATE_KEY", undefined);
    const apple200 = await apple(200);
    expect((await tag()).status).toBe(401);
    expect(apple200.requests).toEqual([]);
    expect(logged(warn)).toContain("DEVICECHECK_KEY_ID and DEVICECHECK_PRIVATE_KEY must be set");
  });

  it("is refused, warned only about the App ID, while the App ID isn't configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("APPLE_TEAM_ID", undefined);
    const apple200 = await apple(200);
    expect((await tag()).status).toBe(401);
    expect(apple200.requests).toEqual([]);
    expect(logged(warn)).toContain("APPLE_TEAM_ID and APPLE_BUNDLE_ID must be set");
    expect(logged(warn)).not.toContain("DEVICECHECK");
  });
});

describe("a DeviceCheck token", () => {
  it("works once: a second write with it is refused, even under another device ID", async () => {
    await apple(200);
    expect((await tag()).status).toBe(201);
    const again = await tag({ device: DEVICE_B });
    expect(again.status).toBe(401);
    expect(await again.json()).toEqual(refusal);
  });

  it("is kept only as its SHA-256, with the day", async () => {
    await apple(200);
    expect((await tag()).status).toBe(201);
    expect(await db.select().from(deviceCheckTokens)).toEqual([
      {
        tokenHash: createHash("sha256").update(TOKEN).digest("hex"),
        seenOn: new Date().toISOString().slice(0, 10),
      },
    ]);
  });

  it("isn't spent by a write the server refuses for another reason", async () => {
    await apple(200);
    expect((await tag({ meeting: randomUUID() })).status).toBe(404);
    expect((await tag()).status).toBe(201);
  });

  it("lets exactly one of two concurrent writes through", async () => {
    await apple(200);
    // Both writes wait on the meeting: the first holding the token, uncommitted, and the second waiting behind it.
    const { writes } = await whileHolding(
      "select 1 from meetings where id = $1 for update",
      [meetingId],
      async (holder) => {
        let settled = 0;
        const writes = Promise.all(
          [tag(), tag({ device: DEVICE_B })].map((write) => write.finally(() => (settled += 1))),
        );
        await untilWaitingOnLock(holder.pid, () => settled === 2, 2);
        return { writes };
      },
    );
    expect((await writes).map((res) => res.status).sort()).toEqual([201, 401]);
  });
});
