import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST as tagRoute } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { deviceDays, devices, tagSubmissions } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { saveAttestKey } from "@/server/attest/keys";
import { blockDevice } from "@/server/devices/block-device";
import { foldDeviceDays } from "@/server/devices/device-days";
import { runMaintenance } from "@/server/maintenance";

import { resetDb, untilWaitingOnLock, whileHolding } from "./db";
import {
  DEVICE_A_HASH,
  DEVICE_B,
  DEVICE_B_HASH,
  deviceHeaders,
  elsewhere,
  seedMeetingStarted,
} from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

const KEY_ID = "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=";
const DAY_MS = 86_400_000;
const utcDay = (offset = 0) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

function tag(meetingId: string, headers = deviceHeaders()) {
  return tagRoute(
    new Request("http://test/api/v1/tags", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ meetingId, tags: ["quiet"] }),
    }),
  );
}

// Every devices row's xmin and xmax (the latter set by a lock or update), as text.
const stamps = async () =>
  (
    await db.execute<{ xmin: string; xmax: string }>(
      sql`select xmin::text, xmax::text from devices order by device_hash`,
    )
  ).rows;

describe("a write and the device's record", () => {
  it("leaves the device's record untouched: neither its xmin nor its xmax moves", async () => {
    await db.insert(devices).values({ deviceHash: DEVICE_A_HASH, platform: "ios", lastSeenDate: utcDay(-1) });
    const before = await stamps();
    expect((await tag(await seedMeetingStarted(1))).status).toBe(201);
    expect((await tag(await seedMeetingStarted(1, elsewhere(1)))).status).toBe(201);
    expect(await stamps()).toEqual(before);
  });

  it("puts no device record within one transaction id of a fresh tag row (spec §2)", async () => {
    await db.insert(devices).values([
      { deviceHash: DEVICE_A_HASH, platform: "ios" },
      { deviceHash: DEVICE_B_HASH, platform: "android" },
    ]);
    const meetingId = await seedMeetingStarted(1);
    await tag(meetingId);
    await tag(meetingId, deviceHeaders(DEVICE_B, "android"));
    await tag(await seedMeetingStarted(1, elsewhere(1)));
    const { rows } = await db.execute<{ linked: number }>(sql`
      select count(*)::int as linked from devices d join tag_submissions s
        on abs(s.xmin::text::bigint - d.xmin::text::bigint) <= 1
        or (d.xmax::text::bigint <> 0 and abs(s.xmin::text::bigint - d.xmax::text::bigint) <= 1)
    `);
    expect(rows).toEqual([{ linked: 0 }]);
  });

  it("notes the day in device_days only, and makes no record for a new phone until the night", async () => {
    expect((await tag(await seedMeetingStarted(1))).status).toBe(201);
    expect(await db.select().from(devices)).toEqual([]);
    expect(await db.select().from(deviceDays)).toEqual([
      { deviceHash: DEVICE_A_HASH, day: utcDay(), platform: "ios", attestKeyId: null, attestCounter: null },
    ]);
  });

  it("notes a day once: a later write that day leaves its row as it was", async () => {
    await tag(await seedMeetingStarted(1));
    const day = () =>
      db.execute<{ xmin: string; xmax: string }>(sql`select xmin::text, xmax::text from device_days`);
    const before = (await day()).rows;
    await tag(await seedMeetingStarted(1, elsewhere(1)));
    expect((await day()).rows).toEqual(before);
  });

  it("still refuses a blocked device at once", async () => {
    await db.insert(devices).values({ deviceHash: DEVICE_A_HASH, platform: "ios", blocked: true });
    const res = await tag(await seedMeetingStarted(1));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "device_blocked" } });
    expect(await db.select().from(tagSubmissions)).toEqual([]);
  });

  it("blocks a phone that wrote since the last night's fold, and refuses its next write", async () => {
    await tag(await seedMeetingStarted(1));
    expect(await blockDevice(DEVICE_A_HASH)).toEqual({ excludedTags: 1 });
    const [row] = await db.select().from(devices).where(eq(devices.deviceHash, DEVICE_A_HASH));
    expect(row).toMatchObject({
      platform: "ios",
      blocked: true,
      firstSeenDate: utcDay(),
      lastSeenDate: utcDay(),
    });
    expect((await tag(await seedMeetingStarted(1, elsewhere(1)))).status).toBe(403);
  });

  it("blocks only that phone, with its record made from all its days", async () => {
    await db.insert(deviceDays).values([
      { deviceHash: DEVICE_A_HASH, day: utcDay(-1), platform: "ios" },
      { deviceHash: DEVICE_B_HASH, day: utcDay(), platform: "android" },
    ]);
    await tag(await seedMeetingStarted(1));
    expect(await blockDevice(DEVICE_A_HASH)).toEqual({ excludedTags: 1 });
    expect(
      (await db.select().from(devices)).map((row) => [
        row.deviceHash,
        row.firstSeenDate,
        row.lastSeenDate,
        row.blocked,
      ]),
    ).toEqual([[DEVICE_A_HASH, utcDay(-1), utcDay(), true]]);
  });

  it("commits the block of a phone with only its days before it waits for the device lock", async () => {
    await tag(await seedMeetingStarted(1));
    const { blocking, blockedMeanwhile } = await whileHolding(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      [DEVICE_A_HASH],
      async (holder) => {
        let settled = false;
        const blocking = blockDevice(DEVICE_A_HASH).finally(() => (settled = true));
        await untilWaitingOnLock(holder.pid, () => settled);
        // What a write waiting behind the exclusion's lock would read once it got the lock.
        const blockedMeanwhile = await holder.query("select blocked from devices where device_hash = $1", [
          DEVICE_A_HASH,
        ]);
        return { blocking, blockedMeanwhile };
      },
    );
    expect(await blocking).toEqual({ excludedTags: 1 });
    expect(blockedMeanwhile).toMatchObject({ rows: [{ blocked: true }] });
  });

  it("still blocks a phone whose record the nightly fold adds while the block is being made", async () => {
    await tag(await seedMeetingStarted(1));
    const lockDevice = "select pg_advisory_xact_lock(hashtextextended($1, 0))";
    const { blocking, blockedMeanwhile } = await whileHolding(
      lockDevice,
      [DEVICE_A_HASH],
      async (exclusion) => {
        // The fold's insert, not yet committed: the block's own insert waits for it, then meets its row.
        const { blocking } = await whileHolding(
          "insert into devices (device_hash, platform) values ($1, 'ios')",
          [DEVICE_A_HASH],
          async (fold) => {
            let settled = false;
            const blocking = blockDevice(DEVICE_A_HASH).finally(() => (settled = true));
            await untilWaitingOnLock(fold.pid, () => settled);
            return { blocking: { promise: blocking, settled: () => settled } };
          },
        );
        await untilWaitingOnLock(exclusion.pid, blocking.settled);
        // What a write waiting behind the exclusion's lock would read once it got the lock.
        const blockedMeanwhile = await exclusion.query("select blocked from devices");
        return { blocking: blocking.promise, blockedMeanwhile };
      },
    );
    expect(await blocking).toEqual({ excludedTags: 1 });
    expect(blockedMeanwhile).toMatchObject({ rows: [{ blocked: true }] });
  });
});

describe("the nightly fold", () => {
  it("adds new phones, moves last-seen on and keeps the highest counter for the current key, in one transaction", async () => {
    await db.insert(devices).values({
      deviceHash: DEVICE_A_HASH,
      platform: "ios",
      firstSeenDate: "2026-01-01",
      lastSeenDate: "2026-01-02",
      attestKeyId: KEY_ID,
      attestPublicKey: "MFkw",
      attestCounter: 3,
    });
    await db.insert(deviceDays).values([
      { deviceHash: DEVICE_A_HASH, day: utcDay(-1), platform: "ios", attestKeyId: KEY_ID, attestCounter: 5 },
      { deviceHash: DEVICE_A_HASH, day: utcDay(), platform: "ios", attestKeyId: KEY_ID, attestCounter: 9 },
      { deviceHash: DEVICE_B_HASH, day: utcDay(), platform: "android" },
    ]);
    expect(await foldDeviceDays()).toBe(2);
    const folded = await db.select().from(devices).orderBy(devices.deviceHash);
    expect(
      folded.map((row) => [
        row.deviceHash,
        row.platform,
        row.firstSeenDate,
        row.lastSeenDate,
        row.attestCounter,
      ]),
    ).toEqual([
      [DEVICE_B_HASH, "android", utcDay(), utcDay(), null],
      [DEVICE_A_HASH, "ios", "2026-01-01", utcDay(), 9],
    ]);
    const { rows } = await db.execute<{ ids: number }>(
      sql`select count(distinct xmin::text)::int as ids from devices`,
    );
    expect(rows).toEqual([{ ids: 1 }]);
  });

  it("gives a new phone its earliest day as first seen and its latest as last seen", async () => {
    await db.insert(deviceDays).values([
      { deviceHash: DEVICE_B_HASH, day: utcDay(-1), platform: "android" },
      { deviceHash: DEVICE_B_HASH, day: utcDay(), platform: "android" },
    ]);
    await foldDeviceDays();
    expect((await db.select().from(devices)).map((row) => [row.firstSeenDate, row.lastSeenDate])).toEqual([
      [utcDay(-1), utcDay()],
    ]);
  });

  it("never moves last-seen back, as for a phone that registered today and last wrote yesterday", async () => {
    await saveAttestKey({ platform: "ios", deviceHash: DEVICE_A_HASH }, KEY_ID, "MFkw");
    await db.insert(deviceDays).values({ deviceHash: DEVICE_A_HASH, day: utcDay(-1), platform: "ios" });
    await foldDeviceDays();
    expect((await db.select().from(devices)).map((row) => [row.lastSeenDate, row.attestCounter])).toEqual([
      [utcDay(), 0],
    ]);
  });

  it("ignores a counter from a key the phone has since replaced", async () => {
    await saveAttestKey({ platform: "ios", deviceHash: DEVICE_A_HASH }, KEY_ID, "MFkw");
    await db.insert(deviceDays).values({
      deviceHash: DEVICE_A_HASH,
      day: utcDay(),
      platform: "ios",
      attestKeyId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      attestCounter: 40,
    });
    await foldDeviceDays();
    const [row] = await db.select().from(devices);
    expect(row?.attestCounter).toBe(0);
  });

  it("moves a just-registered phone's record away from its first write's tag row", async () => {
    await saveAttestKey({ platform: "ios", deviceHash: DEVICE_A_HASH }, KEY_ID, "MFkw");
    await tag(await seedMeetingStarted(1));
    // Other traffic comes between a write and the night's fold: the fold's own neighbour is an accepted residual.
    await db.execute(sql`select pg_current_xact_id()`);
    await foldDeviceDays();
    const { rows } = await db.execute<{ linked: number }>(sql`
      select count(*)::int as linked from devices d join tag_submissions s
        on abs(s.xmin::text::bigint - d.xmin::text::bigint) <= 1
    `);
    expect(rows).toEqual([{ linked: 0 }]);
  });

  it("never brings back the record of a phone whose data delete-mine is deleting meanwhile (spec §7)", async () => {
    await db.insert(deviceDays).values([
      { deviceHash: DEVICE_A_HASH, day: utcDay(), platform: "ios" },
      { deviceHash: DEVICE_B_HASH, day: utcDay(), platform: "android" },
    ]);
    // delete-mine's transaction, part way: the phone's days deleted, not yet committed.
    const { folding } = await whileHolding(
      "delete from device_days where device_hash = $1",
      [DEVICE_A_HASH],
      async (deletion) => {
        let settled = false;
        const folding = foldDeviceDays().finally(() => (settled = true));
        await untilWaitingOnLock(deletion.pid, () => settled);
        return { folding };
      },
    );
    expect(await folding).toBe(1);
    expect((await db.select().from(devices)).map((row) => row.deviceHash)).toEqual([DEVICE_B_HASH]);
  });

  it("runs first in the nightly maintenance, which then deletes days older than yesterday", async () => {
    await db.insert(deviceDays).values([
      { deviceHash: DEVICE_A_HASH, day: utcDay(-2), platform: "ios" },
      { deviceHash: DEVICE_A_HASH, day: utcDay(-1), platform: "ios" },
    ]);
    expect(await runMaintenance()).toMatchObject({ devicesFolded: 1, deviceDaysPurged: 1 });
    expect((await db.select().from(deviceDays)).map((row) => row.day)).toEqual([utcDay(-1)]);
    expect((await db.select().from(devices)).map((row) => row.lastSeenDate)).toEqual([utcDay(-1)]);
  });

  it("folds a day before purging it, so a phone seen only before yesterday still gets its record", async () => {
    await db.insert(deviceDays).values({ deviceHash: DEVICE_B_HASH, day: utcDay(-2), platform: "android" });
    expect(await runMaintenance()).toMatchObject({ devicesFolded: 1, deviceDaysPurged: 1 });
    expect(await db.select().from(deviceDays)).toEqual([]);
    expect((await db.select().from(devices)).map((row) => [row.deviceHash, row.lastSeenDate])).toEqual([
      [DEVICE_B_HASH, utcDay(-2)],
    ]);
  });
});
