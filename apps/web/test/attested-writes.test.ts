import { format } from "node:util";

import { ERROR_MESSAGES } from "@mymeetingapp/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE as deleteTagRoute, PUT as editTagRoute } from "@/app/api/v1/tags/[meetingId]/route";
import { POST as deleteMineRoute } from "@/app/api/v1/tags/delete-mine/route";
import { POST as tagRoute } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { deviceDays, devices, tagSubmissions } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { saveAttestKey } from "@/server/attest/keys";
import { foldDeviceDays } from "@/server/devices/device-days";

import { attestedHeaders, stubAppAttest, type TestAttestKey, testAttestKey } from "./attest-fixtures";
import { resetDb, untilWaitingOnLock, whileHolding } from "./db";
import {
  DEVICE_A_HASH,
  DEVICE_B,
  DEVICE_B_HASH,
  deviceHeaders,
  elsewhere,
  seedMeetingStarted,
} from "./tag-fixtures";

const TAGS = "/api/v1/tags";
const DELETE_MINE = "/api/v1/tags/delete-mine";
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const LOCK_DEVICE = "select pg_advisory_xact_lock(hashtextextended($1, 0))";
const refusal = { error: { code: "attestation_failed", message: ERROR_MESSAGES.attestation_failed } };

let key: TestAttestKey;
let meetingId: string;
let body: string;

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
  stubAppAttest();
  key = testAttestKey();
  await saveAttestKey({ platform: "ios", deviceHash: DEVICE_A_HASH }, key.keyId, key.publicKey);
  meetingId = await seedMeetingStarted(1);
  body = JSON.stringify({ meetingId, tags: ["quiet"] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => pool.end());

function tag(headers: Record<string, string>, text = body) {
  return tagRoute(
    new Request(`http://test${TAGS}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: text,
    }),
  );
}

const signed = (
  counter: number,
  change: { method?: string; path?: string; body?: string; timestamp?: number } = {},
) => attestedHeaders(key, counter, { method: "POST", path: TAGS, body, ...change });

// A tag write for another meeting, so it isn't refused as already tagged.
async function otherWrite(): Promise<string> {
  return JSON.stringify({ meetingId: await seedMeetingStarted(2, elsewhere(1)), tags: ["quiet"] });
}

// The highest counter a write kept: on today's device_days row (Task 5A), never on the device's record.
const storedCounter = async () => {
  const { rows } = await db.execute<{ highest: string | null }>(
    sql`select max(attest_counter)::text as highest from device_days`,
  );
  return Number(rows[0]?.highest ?? 0);
};
const savedTags = async () => (await db.select().from(tagSubmissions)).length;

describe("a write while app checks are required", () => {
  it("is accepted when signed over its exact method, path, clock and body, and keeps the new counter", async () => {
    expect((await tag(signed(1))).status).toBe(201);
    expect(await storedCounter()).toBe(1);
    expect(await savedTags()).toBe(1);
  });

  it.each<[string, () => Record<string, string>, string?]>([
    ["no X-Attestation", () => deviceHeaders()],
    ["a header that isn't a proof", () => ({ ...deviceHeaders(), "X-Attestation": "assertion" })],
    [
      "a body other than the one signed",
      () => signed(1),
      JSON.stringify({ meetingId: "", tags: ["lively"] }),
    ],
    ["a proof signed for another path", () => signed(1, { path: "/api/v1/suggestions" })],
    ["a proof signed for another method", () => signed(1, { method: "PUT" })],
    [
      "a key this phone never registered",
      () => attestedHeaders(testAttestKey(), 1, { method: "POST", path: TAGS, body }),
    ],
    ["a phone clock 25 hours behind", () => signed(1, { timestamp: Date.now() - 25 * HOUR_MS })],
    ["a counter of 0, which no assertion carries", () => signed(0)],
  ])("is refused, and nothing saved, with %s", async (_why, headers, text) => {
    const res = await tag(headers(), text);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(refusal);
    expect(await savedTags()).toBe(0);
    expect(await storedCounter()).toBe(0);
  });

  it("refuses a proof signed for another app", async () => {
    vi.stubEnv("APPLE_BUNDLE_ID", "com.goodersoftware.another");
    expect(await (await tag(signed(1))).json()).toEqual(refusal);
  });

  it("refuses every proof, with a warning, while the App ID isn't configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("APPLE_TEAM_ID", undefined);
    expect(await (await tag(signed(1))).json()).toEqual(refusal);
    expect(warn.mock.calls.map((args) => format(...args)).join("\n")).toContain("APPLE_TEAM_ID");
  });

  it("refuses a key another phone registered", async () => {
    const theirs = testAttestKey();
    await saveAttestKey({ platform: "ios", deviceHash: "f".repeat(64) }, theirs.keyId, theirs.publicKey);
    const headers = attestedHeaders(theirs, 1, { method: "POST", path: TAGS, body });
    expect(await (await tag(headers)).json()).toEqual(refusal);
  });

  it("accepts a phone clock 23 hours off and refuses one 25 hours off", async () => {
    expect((await tag(signed(1, { timestamp: Date.now() + 23 * HOUR_MS }))).status).toBe(201);
    const later = await otherWrite();
    expect((await tag(signed(2, { body: later, timestamp: Date.now() + 25 * HOUR_MS }), later)).status).toBe(
      401,
    );
  });

  it.each([
    ["behind", -1],
    ["ahead", 1],
  ])("holds a clock %s to a day: a minute inside it passes, a minute outside fails", async (_way, sign) => {
    const outside = signed(1, { timestamp: Date.now() + sign * (DAY_MS + MINUTE_MS) });
    expect(await (await tag(outside)).json()).toEqual(refusal);
    expect((await tag(signed(1, { timestamp: Date.now() + sign * (DAY_MS - MINUTE_MS) }))).status).toBe(201);
  });

  it("refuses an assertion whose counter isn't above the last one, so a replay fails", async () => {
    const headers = signed(1);
    expect((await tag(headers)).status).toBe(201);
    expect(await (await tag(headers)).json()).toEqual(refusal);
  });

  it("accepts two writes in quick succession whose counters arrive in order, and keeps the higher", async () => {
    const later = await otherWrite();
    expect((await tag(signed(1))).status).toBe(201);
    expect((await tag(signed(2, { body: later }), later)).status).toBe(201);
    expect(await storedCounter()).toBe(2);
    expect(await savedTags()).toBe(2);
  });

  it("refuses a write whose counter arrives below one already kept", async () => {
    const later = await otherWrite();
    expect((await tag(signed(3, { body: later }), later)).status).toBe(201);
    expect(await (await tag(signed(2))).json()).toEqual(refusal);
    expect(await storedCounter()).toBe(3);
  });

  it("lets a retried write through when it signs again with the next counter, and a refused write keeps no counter", async () => {
    expect((await tag(signed(1))).status).toBe(201);
    // The tag already exists, so the server's answer moves on to its own rules: the check passed.
    expect(await (await tag(signed(2))).json()).toMatchObject({ error: { code: "already_tagged" } });
    // Refused, the write kept nothing, so its counter isn't recorded either.
    expect(await storedCounter()).toBe(1);
  });

  it("refuses a replay as a failed check before the server's own rules, even from a blocked phone", async () => {
    const headers = signed(1);
    expect((await tag(headers)).status).toBe(201);
    await db.update(devices).set({ blocked: true }).where(eq(devices.deviceHash, DEVICE_A_HASH));
    expect(await (await tag(headers)).json()).toEqual(refusal);
  });

  it("lets only one of two writes signed with the same counter through, checked again under the device lock", async () => {
    const second = await otherWrite();
    // Both pass the first check (nothing kept yet) and wait on the device lock; only the first through it keeps 1.
    const { writes } = await whileHolding(LOCK_DEVICE, [DEVICE_A_HASH], async (holder) => {
      let settled = 0;
      const writes = Promise.all(
        [tag(signed(1)), tag(signed(1, { body: second }), second)].map((write) =>
          write.finally(() => (settled += 1)),
        ),
      );
      await untilWaitingOnLock(holder.pid, () => settled === 2, 2);
      return { writes };
    });
    expect((await writes).map((res) => res.status).sort()).toEqual([201, 401]);
    expect(await storedCounter()).toBe(1);
    expect(await savedTags()).toBe(1);
  });

  it("refuses a counter at or below the one folded into the device's record", async () => {
    expect((await tag(signed(4))).status).toBe(201);
    await foldDeviceDays();
    await db.delete(deviceDays);
    const later = await otherWrite();
    expect(await (await tag(signed(4, { body: later }), later)).json()).toEqual(refusal);
    expect((await tag(signed(5, { body: later }), later)).status).toBe(201);
  });

  it("starts a newly registered key afresh, whatever the old key signed today", async () => {
    expect((await tag(signed(9))).status).toBe(201);
    key = testAttestKey();
    await saveAttestKey({ platform: "ios", deviceHash: DEVICE_A_HASH }, key.keyId, key.publicKey);
    const later = await otherWrite();
    expect((await tag(signed(1, { body: later }), later)).status).toBe(201);
    expect(
      await db.select({ key: deviceDays.attestKeyId, counter: deviceDays.attestCounter }).from(deviceDays),
    ).toEqual([{ key: key.keyId, counter: 1 }]);
  });

  it("keeps the counter on today's device_days row and never writes the device's record (Task 5A)", async () => {
    const stamps = async () =>
      (await db.execute<{ xmin: string; xmax: string }>(sql`select xmin::text, xmax::text from devices`))
        .rows;
    const later = await otherWrite();
    const before = await stamps();
    expect((await tag(signed(1))).status).toBe(201);
    expect((await tag(signed(2, { body: later }), later)).status).toBe(201);
    expect(await stamps()).toEqual(before);
    expect(await storedCounter()).toBe(2);
  });

  it("checks deletions too, over their empty body", async () => {
    const deleteMine = (headers: Record<string, string>) =>
      deleteMineRoute(new Request(`http://test${DELETE_MINE}`, { method: "POST", headers }));
    expect((await deleteMine(deviceHeaders())).status).toBe(401);
    // Signed over an empty body, sent with one: the check covers the bytes received.
    const withBody = new Request(`http://test${DELETE_MINE}`, {
      method: "POST",
      headers: signed(1, { path: DELETE_MINE, body: "" }),
      body: "{}",
    });
    expect(await (await deleteMineRoute(withBody)).json()).toEqual(refusal);
    expect((await deleteMine(signed(1, { path: DELETE_MINE, body: "" }))).status).toBe(200);
  });

  it.each<[string, () => Promise<Response>]>([
    [
      "deleting one meeting's tags",
      () =>
        deleteTagRoute(
          new Request(`http://test${TAGS}/${meetingId}`, {
            method: "DELETE",
            headers: signed(2, { method: "DELETE", path: `${TAGS}/${meetingId}`, body: "" }),
          }),
          { params: Promise.resolve({ meetingId }) },
        ),
    ],
    [
      "delete-mine",
      () =>
        deleteMineRoute(
          new Request(`http://test${DELETE_MINE}`, {
            method: "POST",
            headers: signed(2, { path: DELETE_MINE, body: "" }),
          }),
        ),
    ],
  ])(
    "refuses %s when a higher counter got through while it waited on the device lock",
    async (_what, remove) => {
      expect((await tag(signed(1))).status).toBe(201);
      const { removing } = await whileHolding(LOCK_DEVICE, [DEVICE_A_HASH], async (holder) => {
        let settled = false;
        const removing = remove().finally(() => (settled = true));
        await untilWaitingOnLock(holder.pid, () => settled);
        // A write signed with counter 3, committing ahead of the deletion that signed 2.
        await holder.query("update device_days set attest_counter = 3 where device_hash = $1", [
          DEVICE_A_HASH,
        ]);
        return { removing };
      });
      expect(await (await removing).json()).toEqual(refusal);
      expect(await savedTags()).toBe(1);
    },
  );

  it("refuses Android until Play Integrity arrives in Phase 6b, even with an App Attest key on its record", async () => {
    expect((await tag(deviceHeaders(DEVICE_B, "android"))).status).toBe(401);
    const android = testAttestKey();
    await saveAttestKey({ platform: "android", deviceHash: DEVICE_B_HASH }, android.keyId, android.publicKey);
    const proof = attestedHeaders(android, 1, { method: "POST", path: TAGS, body });
    const headers = { ...proof, ...deviceHeaders(DEVICE_B, "android") };
    expect(await (await tag(headers)).json()).toEqual(refusal);
  });

  it("refuses a proof signed for one route when it's sent to another", async () => {
    // A tag write's proof, replayed against delete-mine with the same body.
    const replayed = new Request(`http://test${DELETE_MINE}`, { method: "POST", headers: signed(1), body });
    expect(await (await deleteMineRoute(replayed)).json()).toEqual(refusal);
  });

  it("refuses a proof signed for one method when it's sent with another", async () => {
    expect((await tag(signed(1))).status).toBe(201);
    const path = `${TAGS}/${meetingId}`;
    const edit = JSON.stringify({ tags: ["lively"] });
    const res = await editTagRoute(
      new Request(`http://test${path}`, {
        method: "PUT",
        headers: { ...signed(2, { method: "POST", path, body: edit }), "content-type": "application/json" },
        body: edit,
      }),
      { params: Promise.resolve({ meetingId }) },
    );
    expect(await res.json()).toEqual(refusal);
  });
});

describe("a write while app checks are off", () => {
  it("ignores X-Attestation entirely", async () => {
    vi.stubEnv("REQUIRE_ATTESTATION", "off");
    expect((await tag({ ...deviceHeaders(), "X-Attestation": "not a proof" })).status).toBe(201);
  });
});
