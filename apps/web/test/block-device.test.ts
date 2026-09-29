import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { tagSubmissions } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { blockDevice } from "@/server/devices/block-device";
import { mergeDuplicateMeetings } from "@/server/meetings/merge";

import { resetDb } from "./db";
import {
  countsOf,
  DEVICE_A_HASH,
  DEVICE_B,
  deviceHeaders,
  elsewhere,
  seedDuplicateCopies,
  seedMeetingStarted,
  whileTagWriteHolds,
} from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
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

describe("blockDevice", () => {
  it("excludes the device's rows on every meeting, recounts them, and refuses its later writes", async () => {
    const { older, newer } = await seedDuplicateCopies();
    const other = await seedMeetingStarted(1, elsewhere(1));
    await tag(newer);
    await tag(other);
    await tag(other, deviceHeaders(DEVICE_B, "android"));
    await db.transaction((tx) => mergeDuplicateMeetings([newer], tx));

    expect(await blockDevice(DEVICE_A_HASH)).toEqual({ excludedTags: 2 });

    expect(await countsOf(older)).toEqual([]);
    expect(await countsOf(other)).toEqual([["quiet", 1, 0]]);
    expect((await db.select().from(tagSubmissions)).map((row) => row.excluded).sort()).toEqual([
      false,
      true,
      true,
    ]);
    const third = await seedMeetingStarted(1, elsewhere(2));
    const res = await tag(third);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "device_blocked" } });
  });

  it("waits for another device's write to a meeting it shares, then recounts it", async () => {
    const meetingId = await seedMeetingStarted(1);
    await tag(meetingId);
    await tag(meetingId, deviceHeaders(DEVICE_B, "android"));
    expect(await whileTagWriteHolds(meetingId, () => blockDevice(DEVICE_A_HASH))).toEqual({
      excludedTags: 1,
    });
    expect(await countsOf(meetingId)).toEqual([["quiet", 1, 0]]);
  });

  it("leaves no transaction id linking the blocked device's record to its excluded rows (spec §2)", async () => {
    await tag(await seedMeetingStarted(1));
    await blockDevice(DEVICE_A_HASH);
    const { rows } = await db.execute<{ linked: number }>(
      sql`select count(*)::int as linked from devices d join tag_submissions s on s.xmin = d.xmin`,
    );
    expect(rows).toEqual([{ linked: 0 }]);
  });

  it("refuses a hash no device has", async () => {
    await expect(blockDevice("f".repeat(64))).rejects.toThrow("No device has that hash");
  });
});
