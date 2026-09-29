import { DeleteMineResponse } from "@mymeetingapp/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as deleteMineRoute } from "@/app/api/v1/tags/delete-mine/route";
import { POST } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { devices, rateLimits, suggestions, tagAudit, tagSubmissions } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { mergeDuplicateMeetings } from "@/server/meetings/merge";

import { resetDb } from "./db";
import {
  countsOf,
  DEVICE_A_HASH,
  DEVICE_B,
  DEVICE_B_HASH,
  deviceHeaders,
  elsewhere,
  seedDuplicateCopies,
  seedMeetingStarted,
} from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => pool.end());

function tag(meetingId: string, headers = deviceHeaders()) {
  return POST(
    new Request("http://test/api/v1/tags", {
      method: "POST",
      headers,
      body: JSON.stringify({ meetingId, tags: ["quiet"] }),
    }),
  );
}

function deleteMine(headers = deviceHeaders()) {
  return deleteMineRoute(new Request("http://test/api/v1/tags/delete-mine", { method: "POST", headers }));
}

describe("POST /api/v1/tags/delete-mine", () => {
  it("removes every tag, audit row, rate-limit row, suggestion link and device record for the device", async () => {
    const first = await seedMeetingStarted(1, elsewhere(1));
    const second = await seedMeetingStarted(1, elsewhere(2));
    await tag(first);
    await tag(second);
    await tag(first, deviceHeaders(DEVICE_B, "android"));
    await db.insert(suggestions).values([
      { text: "Candlelight", deviceHash: DEVICE_A_HASH },
      { text: "Big print", deviceHash: DEVICE_B_HASH },
    ]);

    const res = await deleteMine();
    expect(res.status).toBe(200);
    expect(DeleteMineResponse.parse(await res.json())).toEqual({ deletedTags: 2 });

    expect(await db.select().from(tagSubmissions)).toHaveLength(1);
    expect(await countsOf(first)).toEqual([["quiet", 1, 0]]);
    expect(await countsOf(second)).toEqual([]);
    expect((await db.select().from(tagAudit)).map((row) => row.deviceHash)).toEqual([DEVICE_B_HASH]);
    expect((await db.select().from(rateLimits)).map((row) => row.deviceHash)).toEqual([DEVICE_B_HASH]);
    expect((await db.select().from(suggestions)).map((row) => [row.text, row.deviceHash]).sort()).toEqual([
      ["Big print", DEVICE_B_HASH],
      ["Candlelight", null],
    ]);
    expect((await db.select().from(devices)).map((row) => row.deviceHash)).toEqual([DEVICE_B_HASH]);
  });

  it("finds the device's rows under a merged-away meeting id", async () => {
    const { newer } = await seedDuplicateCopies();
    await tag(newer);
    await mergeDuplicateMeetings([newer], db);
    expect(DeleteMineResponse.parse(await (await deleteMine()).json())).toEqual({ deletedTags: 1 });
    expect(await db.select().from(tagSubmissions)).toEqual([]);
  });

  it("keeps only a blocked device's hash and block, so deleting can't lift it", async () => {
    const meetingId = await seedMeetingStarted(1);
    await tag(meetingId);
    await db.update(devices).set({ blocked: true });
    expect((await deleteMine()).status).toBe(200);
    expect(await db.select().from(tagSubmissions)).toEqual([]);
    expect((await db.select().from(devices)).map((row) => [row.deviceHash, row.blocked])).toEqual([
      [DEVICE_A_HASH, true],
    ]);
  });

  it("works while tagging is switched off", async () => {
    vi.stubEnv("FEATURE_TAGGING", "off");
    expect((await deleteMine()).status).toBe(200);
  });

  it("needs the device headers", async () => {
    expect((await deleteMine({})).status).toBe(400);
  });
});
