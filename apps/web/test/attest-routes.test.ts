import { format } from "node:util";

import { AttestChallengeResponse, AttestRegisterResponse, ERROR_MESSAGES } from "@mymeetingapp/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { POST as challengeRoute } from "@/app/api/v1/attest/challenge/route";
import { POST as registerRoute } from "@/app/api/v1/attest/register/route";
import { db, pool } from "@/db/client";
import { attestChallenges, devices, rateLimits } from "@/db/schema";
import { sha256 } from "@/server/attest/app-attest";
import { issueChallenge } from "@/server/attest/challenges";
import { saveAttestKey } from "@/server/attest/keys";
import { registerAppAttestKey } from "@/server/attest/register";
import type { WriteDevice } from "@/server/devices/write-request";
import { deleteMine } from "@/server/tags/delete-mine";

import { APPLE_SAMPLE_ATTESTATION } from "./apple-attestation-sample";
import { forgedAttestation } from "./attest-fixtures";
import { resetDb, untilWaitingOnLock, whileHolding } from "./db";
import { DEVICE_A_HASH, DEVICE_B, DEVICE_B_HASH, deviceHeaders } from "./tag-fixtures";

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => pool.end());

const KEY_ID = "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=";

describe("a phone's App Attest key", () => {
  it.each([
    ["the public key", { attestKeyId: KEY_ID }],
    ["the counter", { attestKeyId: KEY_ID, attestPublicKey: "MFkw" }],
  ])("is stored whole or not at all: never without %s", async (_missing, partial) => {
    await expect(
      db.insert(devices).values({ deviceHash: DEVICE_A_HASH, platform: "ios", ...partial }),
    ).rejects.toMatchObject({ cause: { constraint: "devices_attest_check" } });
  });

  it("belongs to one phone only", async () => {
    const key = { attestKeyId: KEY_ID, attestPublicKey: "MFkw", attestCounter: 0 };
    await db.insert(devices).values({ deviceHash: DEVICE_A_HASH, platform: "ios", ...key });
    await expect(
      db.insert(devices).values({ deviceHash: DEVICE_B_HASH, platform: "ios", ...key }),
    ).rejects.toMatchObject({ cause: { constraint: "devices_attest_key_idx" } });
  });
});

const challenge = (headers: Record<string, string> = deviceHeaders()) =>
  challengeRoute(new Request("http://test/api/v1/attest/challenge", { method: "POST", headers }));

const register = (body: unknown, headers: Record<string, string> = deviceHeaders()) =>
  registerRoute(
    new Request("http://test/api/v1/attest/register", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const refusal = { error: { code: "attestation_failed", message: ERROR_MESSAGES.attestation_failed } };

async function issued(): Promise<string> {
  return AttestChallengeResponse.parse(await (await challenge()).json()).challenge;
}

describe("POST /api/v1/attest/challenge", () => {
  it("issues a challenge for 5 minutes, stored with nothing about the phone", async () => {
    const res = await challenge();
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { challenge: given } = AttestChallengeResponse.parse(await res.json());
    const { rows } = await db.execute<{ challenge: string; minutes: number }>(
      sql`select challenge, round(extract(epoch from expires_at - now()) / 60)::int as minutes from attest_challenges`,
    );
    expect(rows).toEqual([{ challenge: given, minutes: 5 }]);
    expect(await db.select().from(devices)).toEqual([]);
  });

  it("needs the device headers", async () => {
    expect((await challenge({})).status).toBe(400);
  });

  it("works for an app below the minimum version, which may still need a key to delete its data", async () => {
    vi.stubEnv("MIN_VERSION_IOS", "9.0.0");
    expect((await challenge()).status).toBe(201);
  });

  it("issues 10 a day to one phone, then refuses with rate_limited", async () => {
    for (let n = 0; n < 10; n++) expect((await challenge()).status).toBe(201);
    const res = await challenge();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: { code: "rate_limited", message: ERROR_MESSAGES.rate_limited },
    });
    expect(await db.select().from(attestChallenges)).toHaveLength(10);
    expect(
      (await db.select().from(rateLimits).where(eq(rateLimits.bucket, "attestation"))).map((row) => [
        row.deviceHash,
        row.count,
      ]),
    ).toEqual([[DEVICE_A_HASH, 10]]);
    expect((await challenge(deviceHeaders(DEVICE_B, "android"))).status).toBe(201);
  });

  it("deletes challenges past their 5 minutes as it issues one, keeping live ones", async () => {
    await db.insert(attestChallenges).values([
      { challenge: "expired", expiresAt: new Date(Date.now() - 1000) },
      { challenge: "live", expiresAt: new Date(Date.now() + 60_000) },
    ]);
    const given = await issued();
    expect((await db.select().from(attestChallenges)).map((row) => row.challenge).sort()).toEqual(
      [given, "live"].sort(),
    );
  });

  it("counts the challenge and stores it in one transaction, so a failed insert spends nothing", async () => {
    await challenge();
    const { rows } = await db.execute<{ ids: number }>(sql`
      select count(distinct xmin::text)::int as ids
        from (select xmin from rate_limits union all select xmin from attest_challenges) both_rows
    `);
    expect(rows).toEqual([{ ids: 1 }]);
  });
});

describe("POST /api/v1/attest/register", () => {
  beforeEach(() => {
    vi.stubEnv("APPLE_TEAM_ID", "PVCZBLDJ73");
    vi.stubEnv("APPLE_BUNDLE_ID", "com.goodersoftware.mymeetingapp");
  });

  const registration = (given: string) => ({
    keyId: KEY_ID,
    attestation: APPLE_SAMPLE_ATTESTATION,
    challenge: given,
  });

  it("answers registered: true, which can't be false: a refusal is an error", () => {
    // tsc checks the type line.
    expectTypeOf(AttestRegisterResponse.parse({ registered: true })).toEqualTypeOf<{ registered: true }>();
    expect(AttestRegisterResponse.safeParse({ registered: false }).success).toBe(false);
  });

  it("trusts Apple's root only: an attestation made under another root is refused", async () => {
    const given = await issued();
    const made = forgedAttestation(sha256(Buffer.from(given)));
    const body = { keyId: made.keyId, attestation: made.attestation, challenge: given };
    expect(await (await register(body)).json()).toEqual(refusal);
    expect(await db.select().from(devices)).toEqual([]);
  });

  // Apple's sample is for another app, over another challenge, with an expired leaf: a real attestation that must fail.
  it("refuses an attestation that doesn't verify, and spends the challenge anyway", async () => {
    const res = await register(registration(await issued()));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(refusal);
    expect(await db.select().from(attestChallenges)).toEqual([]);
    expect(await db.select().from(devices)).toEqual([]);
  });

  it("refuses a challenge it never issued", async () => {
    expect(await (await register(registration("c".repeat(43)))).json()).toEqual(refusal);
  });

  it("refuses a challenge past its 5 minutes", async () => {
    await db
      .insert(attestChallenges)
      .values({ challenge: "e".repeat(43), expiresAt: new Date(Date.now() - 1000) });
    expect((await register(registration("e".repeat(43)))).status).toBe(401);
  });

  it("refuses an Android phone: App Attest is Apple's", async () => {
    const given = await issued();
    expect((await register(registration(given), deviceHeaders(DEVICE_B, "android"))).status).toBe(401);
  });

  it("refuses, and warns, while the App ID isn't configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("APPLE_TEAM_ID", undefined);
    expect((await register(registration(await issued()))).status).toBe(401);
    expect(warn.mock.calls.map((args) => format(...args)).join("\n")).toContain(
      "APPLE_TEAM_ID and APPLE_BUNDLE_ID must be set",
    );
  });

  it("refuses a body that isn't a registration", async () => {
    expect((await register({ keyId: KEY_ID })).status).toBe(400);
  });
});

// A real iPhone's attestation can't be made in a test, so these call registration with a made-up root in Apple's place
// (the route always passes Apple's), against the real database.
describe("registerAppAttestKey", () => {
  beforeEach(() => {
    vi.stubEnv("APPLE_TEAM_ID", "PVCZBLDJ73");
    vi.stubEnv("APPLE_BUNDLE_ID", "com.goodersoftware.mymeetingapp");
  });

  const phone: WriteDevice = { platform: "ios", deviceHash: DEVICE_A_HASH };

  // An attestation for this app over the challenge's SHA-256 (as modules/app-integrity asks Apple for one), and
  // registration of it under the made-up root it chains to.
  function attested(given: string) {
    const made = forgedAttestation(sha256(Buffer.from(given)));
    const request = { keyId: made.keyId, attestation: made.attestation, challenge: given };
    const register = (device = phone, at = new Date()) =>
      registerAppAttestKey(device, request, { root: made.root, at });
    return { ...made, register };
  }
  const issuedTo = async (device = phone) => (await issueChallenge(device)).challenge;
  const refused = { code: "attestation_failed" };

  it("verifies the attestation, stores the phone's key with a counter of 0 and spends the challenge", async () => {
    const made = attested(await issuedTo());
    await made.register();
    const rows = await db.select().from(devices);
    expect(
      rows.map((row) => [row.deviceHash, row.attestKeyId, row.attestPublicKey, row.attestCounter]),
    ).toEqual([[DEVICE_A_HASH, made.keyId, made.publicKey, 0]]);
    expect(await db.select().from(attestChallenges)).toEqual([]);
  });

  it("refuses the same registration a second time: its challenge is spent", async () => {
    const made = attested(await issuedTo());
    await made.register();
    await expect(made.register()).rejects.toMatchObject(refused);
  });

  it("checks the certificates are valid at the moment it's given", async () => {
    const made = attested(await issuedTo());
    await expect(made.register(phone, new Date(Date.now() + 2 * 365 * 86_400_000))).rejects.toMatchObject(
      refused,
    );
  });

  it("refuses an attestation for another app id", async () => {
    vi.stubEnv("APPLE_BUNDLE_ID", "com.goodersoftware.other");
    await expect(attested(await issuedTo()).register()).rejects.toMatchObject(refused);
    expect(await db.select().from(devices)).toEqual([]);
  });

  it("expects Apple's development environment when APP_ATTEST_ENVIRONMENT=development", async () => {
    vi.stubEnv("APP_ATTEST_ENVIRONMENT", "development");
    await expect(attested(await issuedTo()).register()).rejects.toMatchObject(refused);
  });

  it("refuses a challenge past its 5 minutes", async () => {
    await db
      .insert(attestChallenges)
      .values({ challenge: "e".repeat(43), expiresAt: new Date(Date.now() - 1000) });
    await expect(attested("e".repeat(43)).register()).rejects.toMatchObject(refused);
  });

  it("refuses an Android phone: App Attest is Apple's", async () => {
    const android: WriteDevice = { platform: "android", deviceHash: DEVICE_B_HASH };
    await expect(attested(await issuedTo(android)).register(android)).rejects.toMatchObject(refused);
    expect(await db.select().from(devices)).toEqual([]);
  });

  const keyAndBlock = async () =>
    (await db.select().from(devices)).map((row) => [
      row.blocked,
      row.attestKeyId,
      row.attestPublicKey,
      row.attestCounter,
    ]);

  // The privacy policy: a blocked phone's record keeps no App Attest key, so registering can't put one back.
  it("refuses a blocked phone with device_blocked, storing no key and spending the challenge", async () => {
    await db.insert(devices).values({ deviceHash: DEVICE_A_HASH, platform: "ios", blocked: true });
    await expect(attested(await issuedTo()).register()).rejects.toMatchObject({ code: "device_blocked" });
    expect(await keyAndBlock()).toEqual([[true, null, null, null]]);
    expect(await db.select().from(attestChallenges)).toEqual([]);
  });

  it("leaves a blocked phone keyless after Delete all my tags and a new registration", async () => {
    const key = { attestKeyId: KEY_ID, attestPublicKey: "MFkw", attestCounter: 7 };
    await db.insert(devices).values({ deviceHash: DEVICE_A_HASH, platform: "ios", blocked: true, ...key });
    await deleteMine(phone);
    await expect(attested(await issuedTo()).register()).rejects.toMatchObject({ code: "device_blocked" });
    expect(await keyAndBlock()).toEqual([[true, null, null, null]]);
  });

  it("refuses a key another phone already holds, leaving it with that phone", async () => {
    const made = attested(await issuedTo());
    const key = { attestKeyId: made.keyId, attestPublicKey: made.publicKey, attestCounter: 3 };
    await db.insert(devices).values({ deviceHash: DEVICE_B_HASH, platform: "ios", ...key });
    await expect(made.register()).rejects.toMatchObject(refused);
    expect((await db.select().from(devices)).map((row) => row.deviceHash)).toEqual([DEVICE_B_HASH]);
  });
});

describe("saveAttestKey", () => {
  const device = { platform: "ios" as const, deviceHash: DEVICE_A_HASH };
  const keyColumns = async () =>
    (await db.select().from(devices)).map((row) => [
      row.deviceHash,
      row.attestKeyId,
      row.attestPublicKey,
      row.attestCounter,
    ]);

  it("records a new phone with its key and a counter of 0", async () => {
    await saveAttestKey(device, KEY_ID, "MFkw");
    expect(await keyColumns()).toEqual([[DEVICE_A_HASH, KEY_ID, "MFkw", 0]]);
  });

  it("a new registration replaces the phone's old key and starts its counter again", async () => {
    await db.insert(devices).values({
      ...device,
      attestKeyId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      attestPublicKey: "old",
      attestCounter: 41,
      lastSeenDate: "2026-01-02",
    });
    await saveAttestKey(device, KEY_ID, "MFkw");
    expect(await keyColumns()).toEqual([[DEVICE_A_HASH, KEY_ID, "MFkw", 0]]);
    // Last-seen is the nightly fold's to move (Task 5A), never a request's.
    const [row] = await db.select().from(devices);
    expect(row?.lastSeenDate).toBe("2026-01-02");
  });

  it("refuses a blocked phone with device_blocked and stores nothing", async () => {
    await db.insert(devices).values({ ...device, blocked: true });
    await expect(saveAttestKey(device, KEY_ID, "MFkw")).rejects.toMatchObject({ code: "device_blocked" });
    expect(await keyColumns()).toEqual([[DEVICE_A_HASH, null, null, null]]);
  });

  it("refuses a phone blocked while its key is being saved", async () => {
    await db.insert(devices).values(device);
    // The block's own update sits uncommitted, so the save waits on the row, then finds it blocked.
    const { saving } = await whileHolding(
      "update devices set blocked = true where device_hash = $1",
      [DEVICE_A_HASH],
      async (holder) => {
        let settled = false;
        const saving = saveAttestKey(device, KEY_ID, "MFkw").finally(() => (settled = true));
        await untilWaitingOnLock(holder.pid, () => settled);
        return { saving };
      },
    );
    await expect(saving).rejects.toMatchObject({ code: "device_blocked" });
    expect(await keyColumns()).toEqual([[DEVICE_A_HASH, null, null, null]]);
  });

  it("refuses a key another phone already holds", async () => {
    await saveAttestKey({ platform: "ios", deviceHash: DEVICE_B_HASH }, KEY_ID, "MFkw");
    await expect(saveAttestKey(device, KEY_ID, "MFkw")).rejects.toMatchObject({ code: "attestation_failed" });
  });

  it("refuses, with attestation_failed, a key another phone saves at the same moment", async () => {
    // The other phone's save sits uncommitted, so this one's own check can't see it; it waits on the key's index.
    const { saving } = await whileHolding(
      "insert into devices (device_hash, platform, attest_key_id, attest_public_key, attest_counter) values ($1, 'ios', $2, 'MFkw', 0)",
      [DEVICE_B_HASH, KEY_ID],
      async (holder) => {
        let settled = false;
        const saving = saveAttestKey(device, KEY_ID, "MFkw").finally(() => (settled = true));
        await untilWaitingOnLock(holder.pid, () => settled);
        return { saving };
      },
    );
    await expect(saving).rejects.toMatchObject({ code: "attestation_failed" });
    expect((await db.select().from(devices)).map((row) => row.deviceHash)).toEqual([DEVICE_B_HASH]);
  });
});
