import type { X509Certificate } from "node:crypto";
import { format } from "node:util";

import { AttestChallengeResponse, AttestRegisterResponse, ERROR_MESSAGES } from "@mymeetingapp/shared";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { POST as challengeRoute } from "@/app/api/v1/attest/challenge/route";
import { POST as registerRoute } from "@/app/api/v1/attest/register/route";
import { db, pool } from "@/db/client";
import { attestChallenges, devices } from "@/db/schema";
import type * as AppleRoot from "@/server/attest/apple-root";
import { sha256 } from "@/server/attest/app-attest";
import { saveAttestKey } from "@/server/attest/keys";

import { APPLE_SAMPLE_ATTESTATION } from "./apple-attestation-sample";
import { FORGED_VALID_AT, forgedAttestation } from "./attest-fixtures";
import { resetDb } from "./db";
import { DEVICE_A_HASH, DEVICE_B, DEVICE_B_HASH, deviceHeaders } from "./tag-fixtures";

// A real iPhone's attestation can't be made in a test, so the success path trusts a made-up root in Apple's place, for
// the tests that set it. Everything else register.ts does runs as in production.
const trusted = vi.hoisted(() => ({ root: undefined as X509Certificate | undefined }));
vi.mock("@/server/attest/apple-root", async (importOriginal) => {
  const apple = await importOriginal<typeof AppleRoot>();
  return {
    get APPLE_APP_ATTESTATION_ROOT() {
      return trusted.root ?? apple.APPLE_APP_ATTESTATION_ROOT;
    },
  };
});

beforeEach(resetDb);
afterEach(() => {
  trusted.root = undefined;
  vi.useRealTimers();
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

  // An attestation for this app over the challenge's SHA-256 (as modules/app-integrity asks Apple for one), under a
  // made-up root that this test trusts in Apple's place, checked at a moment its certificates are valid.
  function attested(given: string) {
    const made = forgedAttestation(sha256(Buffer.from(given)));
    trusted.root = made.root;
    vi.useFakeTimers({ toFake: ["Date"], now: FORGED_VALID_AT });
    return { ...made, body: { keyId: made.keyId, attestation: made.attestation, challenge: given } };
  }

  it("verifies the attestation, stores the phone's key with a counter of 0 and spends the challenge", async () => {
    const made = attested(await issued());
    const res = await register(made.body);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = AttestRegisterResponse.parse(await res.json());
    expect(body).toEqual({ registered: true });
    // registered is always true: a refusal is an error, never `false` (tsc checks the type line).
    expectTypeOf(body).toEqualTypeOf<{ registered: true }>();
    expect(AttestRegisterResponse.safeParse({ registered: false }).success).toBe(false);
    const rows = await db.select().from(devices);
    expect(
      rows.map((row) => [row.deviceHash, row.attestKeyId, row.attestPublicKey, row.attestCounter]),
    ).toEqual([[DEVICE_A_HASH, made.keyId, made.publicKey, 0]]);
    expect(await db.select().from(attestChallenges)).toEqual([]);
  });

  it("refuses the same registration a second time: its challenge is spent", async () => {
    const made = attested(await issued());
    expect((await register(made.body)).status).toBe(201);
    expect(await (await register(made.body)).json()).toEqual(refusal);
  });

  it("checks the certificates are valid now", async () => {
    const made = attested(await issued());
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    expect(await (await register(made.body)).json()).toEqual(refusal);
  });

  it("refuses an attestation for another app id", async () => {
    vi.stubEnv("APPLE_BUNDLE_ID", "com.goodersoftware.other");
    const made = attested(await issued());
    expect(await (await register(made.body)).json()).toEqual(refusal);
    expect(await db.select().from(devices)).toEqual([]);
  });

  it("expects Apple's development environment when APP_ATTEST_ENVIRONMENT=development", async () => {
    vi.stubEnv("APP_ATTEST_ENVIRONMENT", "development");
    const made = attested(await issued());
    expect(await (await register(made.body)).json()).toEqual(refusal);
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
    const made = attested("e".repeat(43));
    expect((await register(made.body)).status).toBe(401);
  });

  it("refuses an Android phone: App Attest is Apple's", async () => {
    const made = attested(await issued());
    expect((await register(made.body, deviceHeaders(DEVICE_B, "android"))).status).toBe(401);
    expect(await db.select().from(devices)).toEqual([]);
  });

  it("refuses a key another phone already holds, leaving it with that phone", async () => {
    const made = attested(await issued());
    const key = { attestKeyId: made.keyId, attestPublicKey: made.publicKey, attestCounter: 3 };
    await db.insert(devices).values({ deviceHash: DEVICE_B_HASH, platform: "ios", ...key });
    expect(await (await register(made.body)).json()).toEqual(refusal);
    expect((await db.select().from(devices)).map((row) => row.deviceHash)).toEqual([DEVICE_B_HASH]);
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

  it("refuses a key another phone already holds", async () => {
    await saveAttestKey({ platform: "ios", deviceHash: DEVICE_B_HASH }, KEY_ID, "MFkw");
    await expect(saveAttestKey(device, KEY_ID, "MFkw")).rejects.toMatchObject({ code: "attestation_failed" });
  });
});
