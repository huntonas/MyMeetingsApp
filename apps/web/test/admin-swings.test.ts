import { format } from "node:util";

import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as deleteMine } from "@/app/api/v1/tags/delete-mine/route";
import { db, pool } from "@/db/client";
import { devices, tagAudit } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { blockSwingDevice, closeSwing, listOpenSwings, readSwingReview } from "@/server/admin/swings";

import { seedSwing } from "./admin-fixtures";
import { resetDb } from "./db";
import { countsOf, DEVICE_A_HASH, DEVICE_B_HASH, deviceHeaders } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(() => pool.end());

async function blocked(deviceHash: string) {
  const [row] = await db
    .select({ blocked: devices.blocked })
    .from(devices)
    .where(eq(devices.deviceHash, deviceHash));
  return row?.blocked;
}

describe("listOpenSwings", () => {
  it("lists open flags with the meeting's name and the tag's label", async () => {
    const { meetingId, swingId } = await seedSwing();
    expect(await listOpenSwings()).toMatchObject([
      {
        id: swingId,
        meetingId,
        meetingName: "Nooners",
        tagLabel: "Serious tone",
        newDevices: 5,
        priorDevices: 0,
        reviewedAt: null,
      },
    ]);
  });
});

describe("readSwingReview (spec §6)", () => {
  it("lists the phones in the 7-day audit log whose current tags on the meeting include the flagged tag", async () => {
    const { swingId } = await seedSwing();
    const review = await readSwingReview(swingId);
    const hashes = review?.devices.map((device) => device.deviceHash) ?? [];
    expect(hashes).toHaveLength(5);
    expect(hashes).toContain(DEVICE_A_HASH);
    expect(hashes).not.toContain(DEVICE_B_HASH);
    expect(review?.devices.map((device) => device.blocked)).toEqual([false, false, false, false, false]);
  });

  it("drops a device whose audit rows are over 7 days old", async () => {
    const { swingId } = await seedSwing();
    await db
      .update(tagAudit)
      .set({ at: new Date(Date.now() - 8 * 86_400_000) })
      .where(eq(tagAudit.deviceHash, DEVICE_A_HASH));
    const hashes = (await readSwingReview(swingId))?.devices.map((device) => device.deviceHash) ?? [];
    expect(hashes).toHaveLength(4);
    expect(hashes).not.toContain(DEVICE_A_HASH);
  });

  it("drops a device that deleted its data, and a stale block click does nothing", async () => {
    const { swingId } = await seedSwing();
    const res = await deleteMine(
      new Request("http://test/api/v1/tags/delete-mine", { method: "POST", headers: deviceHeaders() }),
    );
    expect(res.status).toBe(200);
    expect((await readSwingReview(swingId))?.devices.map((device) => device.deviceHash)).not.toContain(
      DEVICE_A_HASH,
    );
    expect(await blockSwingDevice({ swingId, deviceHash: DEVICE_A_HASH })).toBe("not_in_review");
  });

  it("finds nothing for a flag that doesn't exist", async () => {
    expect(await readSwingReview(999)).toBeUndefined();
    expect(await blockSwingDevice({ swingId: 999, deviceHash: DEVICE_A_HASH })).toBe("flag_not_found");
  });
});

describe("blockSwingDevice", () => {
  it("blocks a phone behind the flag, excluding its tags everywhere", async () => {
    const { meetingId, swingId } = await seedSwing();
    expect(await blockSwingDevice({ swingId, deviceHash: DEVICE_A_HASH })).toBe("blocked");
    expect(await blocked(DEVICE_A_HASH)).toBe(true);
    expect(await countsOf(meetingId)).toEqual([
      ["quiet", 1, 0],
      ["serious-tone", 4, 0],
    ]);
    const review = await readSwingReview(swingId);
    expect(review?.devices.find((device) => device.deviceHash === DEVICE_A_HASH)?.blocked).toBe(true);
  });

  // blockDevice commits the block before the exclusion (for the xmin privacy fix), so a failure can land between
  // the two. The notice then says so rather than "nothing was changed", and the phone keeps its Block button.
  it("says a block stopped part-way, and a second click finishes it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { meetingId, swingId } = await seedSwing();
    await db.execute(sql`
      create function fail_exclusion() returns trigger language plpgsql as $$
        begin raise exception 'exclusion failed'; end $$`);
    await db.execute(sql`
      create trigger fail_exclusion before update on tag_submissions for each row execute function fail_exclusion()`);
    try {
      expect(await blockSwingDevice({ swingId, deviceHash: DEVICE_A_HASH })).toBe("block_unfinished");
    } finally {
      await db.execute(sql`drop trigger fail_exclusion on tag_submissions`);
      await db.execute(sql`drop function fail_exclusion()`);
    }
    const logged = log.mock.calls.map((args) => format(...args)).join("\n");
    expect(logged).toContain("[admin] block stopped part-way");
    expect(logged).not.toContain(DEVICE_A_HASH);
    expect(await blocked(DEVICE_A_HASH)).toBe(true);
    expect(await countsOf(meetingId)).toEqual([
      ["quiet", 1, 0],
      ["serious-tone", 5, 0],
    ]);
    const review = await readSwingReview(swingId);
    expect(review?.devices.find((device) => device.deviceHash === DEVICE_A_HASH)?.blocked).toBe(false);
    expect(await blockSwingDevice({ swingId, deviceHash: DEVICE_A_HASH })).toBe("blocked");
    expect(await countsOf(meetingId)).toEqual([
      ["quiet", 1, 0],
      ["serious-tone", 4, 0],
    ]);
  });

  it("won't block a phone that isn't behind the flag", async () => {
    const { swingId } = await seedSwing();
    expect(await blockSwingDevice({ swingId, deviceHash: DEVICE_B_HASH })).toBe("not_in_review");
    expect(await blocked(DEVICE_B_HASH)).toBe(false);
  });
});

describe("closeSwing", () => {
  it("closes an open flag once, after which it has no phones to review", async () => {
    const { swingId } = await seedSwing();
    expect(await closeSwing({ swingId })).toBe("closed");
    expect(await listOpenSwings()).toEqual([]);
    expect(await closeSwing({ swingId })).toBe("flag_not_found");
    expect((await readSwingReview(swingId))?.devices).toEqual([]);
    expect(await blockSwingDevice({ swingId, deviceHash: DEVICE_A_HASH })).toBe("not_in_review");
  });
});
