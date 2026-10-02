import { DeleteMineResponse } from "@mymeetingapp/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as deleteMineRoute } from "@/app/api/v1/tags/delete-mine/route";
import { POST } from "@/app/api/v1/tags/route";
import { eq, sql } from "drizzle-orm";

import { db, pool } from "@/db/client";
import {
  aiDecisions,
  devices,
  rateLimits,
  suggestions,
  tagAudit,
  tagCounts,
  tagSubmissions,
} from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { runMaintenance } from "@/server/maintenance";
import { mergeDuplicateMeetings } from "@/server/meetings/merge";

import { resetDb, untilWaitingOnLock, whileHolding } from "./db";
import {
  countsOf,
  DEVICE_A_HASH,
  DEVICE_B,
  DEVICE_B_HASH,
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
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => pool.end());

const KEY_ID = "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=";
const KEY = { attestKeyId: KEY_ID, attestPublicKey: "MFkw", attestCounter: 7 };

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
  it("removes every tag, audit row, rate-limit row, linked suggestion and device record for the device", async () => {
    const first = await seedMeetingStarted(1, elsewhere(1));
    const second = await seedMeetingStarted(1, elsewhere(2));
    await tag(first);
    await tag(second);
    await tag(first, deviceHeaders(DEVICE_B, "android"));
    const suggested = await db
      .insert(suggestions)
      .values([
        { text: "Candlelight", deviceHash: DEVICE_A_HASH },
        { text: "Big print", deviceHash: DEVICE_B_HASH },
        { text: "Reviewed", deviceHash: null },
      ])
      .returning({ id: suggestions.id });
    await db.insert(aiDecisions).values(
      suggested.map(({ id }) => ({
        suggestionId: id,
        input: "x",
        decision: "pending" as const,
        reason: "x",
        model: "m",
      })),
    );

    const res = await deleteMine();
    expect(res.status).toBe(200);
    expect(DeleteMineResponse.parse(await res.json())).toEqual({ deletedTags: 2 });

    expect(await db.select().from(tagSubmissions)).toHaveLength(1);
    expect(await countsOf(first)).toEqual([["quiet", 1, 0]]);
    expect(await countsOf(second)).toEqual([]);
    expect((await db.select().from(tagAudit)).map((row) => row.deviceHash)).toEqual([DEVICE_B_HASH]);
    expect((await db.select().from(rateLimits)).map((row) => row.deviceHash)).toEqual([DEVICE_B_HASH]);
    // Spec §7: the device's still-linked suggestions go, with their AI decisions.
    expect((await db.select().from(suggestions)).map((row) => [row.text, row.deviceHash]).sort()).toEqual([
      ["Big print", DEVICE_B_HASH],
      ["Reviewed", null],
    ]);
    expect(await db.select({ id: aiDecisions.suggestionId }).from(aiDecisions)).toHaveLength(2);
    expect((await db.select().from(devices)).map((row) => row.deviceHash)).toEqual([DEVICE_B_HASH]);
  });

  it("finds the device's rows under a merged-away meeting id", async () => {
    const { newer } = await seedDuplicateCopies();
    await tag(newer);
    await db.transaction((tx) => mergeDuplicateMeetings([newer], tx));
    expect(DeleteMineResponse.parse(await (await deleteMine()).json())).toEqual({ deletedTags: 1 });
    expect(await db.select().from(tagSubmissions)).toEqual([]);
  });

  it("keeps only a blocked device's hash and block, so deleting can't lift it", async () => {
    const meetingId = await seedMeetingStarted(1);
    await tag(meetingId);
    await db.update(devices).set({ blocked: true, ...KEY });
    expect((await deleteMine()).status).toBe(200);
    expect(await db.select().from(tagSubmissions)).toEqual([]);
    // Spec §7: delete-mine deletes the attestation data too, even on the row a block keeps.
    expect(
      (await db.select().from(devices)).map((row) => [
        row.deviceHash,
        row.blocked,
        row.attestKeyId,
        row.attestPublicKey,
        row.attestCounter,
      ]),
    ).toEqual([[DEVICE_A_HASH, true, null, null, null]]);
  });

  it("leaves no transaction id linking a blocked device's kept record to the counts it rewrote (spec §2)", async () => {
    const meetingId = await seedMeetingStarted(1);
    await tag(meetingId);
    await tag(meetingId, deviceHeaders(DEVICE_B, "android"));
    await db
      .update(devices)
      .set({ blocked: true, ...KEY })
      .where(eq(devices.deviceHash, DEVICE_A_HASH));
    expect((await deleteMine()).status).toBe(200);
    // The meeting keeps a count (device B's tag), rewritten by the deletion, beside the record the block keeps.
    expect(await countsOf(meetingId)).toEqual([["quiet", 1, 0]]);
    const { rows } = await db.execute<{ linked: number }>(sql`
      select count(*)::int as linked from ${devices} d join ${tagCounts} c on c.xmin = d.xmin
      where d.device_hash = ${DEVICE_A_HASH}
    `);
    expect(rows).toEqual([{ linked: 0 }]);
  });

  it("works while tagging is switched off", async () => {
    vi.stubEnv("FEATURE_TAGGING", "off");
    expect((await deleteMine()).status).toBe(200);
  });

  it("needs the device headers", async () => {
    expect((await deleteMine({})).status).toBe(400);
  });

  it("waits for a screening recording its decision on the device's suggestion, then deletes both", async () => {
    const [suggestion] = await db
      .insert(suggestions)
      .values({ text: "Candlelight", deviceHash: DEVICE_A_HASH })
      .returning({ id: suggestions.id });
    // Stands in for screenAndApply, which records the AI's decision outside the device lock.
    const { deleting } = await whileHolding(
      "insert into ai_decisions (suggestion_id, input, decision, reason, model) values ($1, 'x', 'pending', 'x', 'm')",
      [suggestion?.id],
      async (holder) => {
        let settled = false;
        const deleting = deleteMine().finally(() => (settled = true));
        await untilWaitingOnLock(holder.pid, () => settled);
        return { deleting };
      },
    );
    expect((await deleting).status).toBe(200);
    expect(await db.select().from(suggestions)).toEqual([]);
    expect(await db.select().from(aiDecisions)).toEqual([]);
  });

  describe("racing other tag writes", () => {
    it("waits for another device's write to a meeting it shares, then recounts it", async () => {
      const meetingId = await seedMeetingStarted(1);
      await tag(meetingId);
      await tag(meetingId, deviceHeaders(DEVICE_B, "android"));
      const res = await whileTagWriteHolds(meetingId, () => deleteMine());
      expect(res.status).toBe(200);
      expect(await countsOf(meetingId)).toEqual([["quiet", 1, 0]]);
    });

    it("takes turns with the nightly maintenance", async () => {
      const meetingId = await seedMeetingStarted(1);
      await tag(meetingId);
      // Old enough for the nightly run to unlink, so both lock this row.
      await db.insert(suggestions).values({
        text: "Candlelight",
        deviceHash: DEVICE_A_HASH,
        createdAt: new Date(Date.now() - 31 * 86_400_000),
      });
      // Stalls delete-mine after it has changed the device's tag rows, before it deletes its audit rows.
      const { deleting, nightly } = await whileHolding(
        "select 1 from tag_audit where device_hash = $1 for update",
        [DEVICE_A_HASH],
        async (holder) => {
          let deleteSettled = false;
          const deleting = deleteMine().finally(() => (deleteSettled = true));
          await untilWaitingOnLock(holder.pid, () => deleteSettled);
          let nightlySettled = false;
          const nightly = runMaintenance().finally(() => (nightlySettled = true));
          await untilWaitingOnLock(holder.pid, () => nightlySettled, 2);
          return { deleting, nightly };
        },
      );
      const [res] = await Promise.all([deleting, nightly]);
      expect(res.status).toBe(200);
      expect(await db.select().from(tagSubmissions)).toEqual([]);
      expect(await countsOf(meetingId)).toEqual([]);
    });

    it("takes turns with the sync's merge of a meeting it holds a row on", async () => {
      const { older, newer } = await seedDuplicateCopies();
      await tag(newer);
      await tag(newer, deviceHeaders(DEVICE_B, "android"));
      // Stalls delete-mine at its recount, after it has deleted its row, until the merge is waiting too.
      const { deleting, merge } = await whileHolding(
        "select 1 from tag_counts where meeting_id = $1 for update",
        [newer],
        async (holder) => {
          let settled = 0;
          const deleting = deleteMine().finally(() => (settled += 1));
          await untilWaitingOnLock(holder.pid, () => settled > 0);
          const merge = db
            .transaction((tx) => mergeDuplicateMeetings([newer], tx))
            .finally(() => (settled += 1));
          await untilWaitingOnLock(holder.pid, () => settled > 0, 2);
          return { deleting, merge };
        },
      );
      const [res] = await Promise.all([deleting, merge]);
      expect(res.status).toBe(200);
      expect(DeleteMineResponse.parse(await res.json())).toEqual({ deletedTags: 1 });
      const rows = await db.select().from(tagSubmissions);
      expect(rows.map((row) => row.meetingId)).toEqual([older]);
      expect(await countsOf(older)).toEqual([["quiet", 1, 0]]);
      expect(await db.select().from(tagSubmissions).where(eq(tagSubmissions.meetingId, newer))).toEqual([]);
    });
  });
});
