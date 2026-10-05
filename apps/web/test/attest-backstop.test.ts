import { ERROR_MESSAGES } from "@mymeetingapp/shared";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as challengeRoute } from "@/app/api/v1/attest/challenge/route";
import { db, pool } from "@/db/client";
import { attestChallenges, rateLimits } from "@/db/schema";

import { resetDb } from "./db";
import { DEVICE_B, deviceHeaders, testDevice } from "./tag-fixtures";

// Every connection this file makes starts in a time zone 12 or more hours from UTC, on whichever side puts the local
// date on another day than UTC's right now, so an hour or a day taken in the session's time zone rather than UTC would
// be wrong. Set through a client of its own before the pool's first connection, and reset after, as the other test
// files share the database.
const SESSION_ZONE = new Date().getUTCHours() < 12 ? "Etc/GMT+12" : "Pacific/Kiritimati";

async function setDatabaseTimeZone(zone: string | null): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query<{ name: string }>("select current_database() as name");
  const name = rows[0]?.name ?? "";
  await client.query(
    zone === null
      ? `alter database "${name}" reset timezone`
      : `alter database "${name}" set timezone = '${zone}'`,
  );
  await client.end();
}

beforeAll(() => setDatabaseTimeZone(SESSION_ZONE));
beforeEach(resetDb);
afterAll(async () => {
  await pool.end();
  await setDatabaseTimeZone(null);
});

const challenge = (headers: Record<string, string> = deviceHeaders()) =>
  challengeRoute(new Request("http://test/api/v1/attest/challenge", { method: "POST", headers }));

// A client can invent device IDs, so one count covers the whole site (owner decision, 2026-10-04, in place of a paid
// Vercel Firewall rule): after 1,000 challenges in a UTC hour, every phone is refused until the hour ends.
describe("the site-wide challenge backstop", () => {
  const siteRows = async () =>
    (await db.select().from(rateLimits).where(eq(rateLimits.bucket, "attestation_site"))).map((row) => [
      row.deviceHash,
      row.windowStart,
      row.count,
    ]);
  // The key the count is kept under: this UTC hour, read from the real clock.
  const hourKey = (hour = new Date().getUTCHours()) => `attestation-site-${String(hour).padStart(2, "0")}`;
  const today = () => new Date().toISOString().slice(0, 10);
  // As if this hour's count were already at `count`, without issuing that many.
  const setSiteCount = (count: number) =>
    db.update(rateLimits).set({ count }).where(eq(rateLimits.bucket, "attestation_site"));

  it("runs against database sessions whose local hour and date aren't UTC's", async () => {
    const { rows } = await pool.query<{ zone: string; local: string; utc: string }>(
      `select current_setting('TimeZone') as zone, to_char(now(), 'YYYY-MM-DD HH24') as local,
              to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24') as utc`,
    );
    const [session] = rows;
    expect(session?.zone).toBe(SESSION_ZONE);
    expect(session?.local.slice(0, 10)).not.toBe(session?.utc.slice(0, 10));
    expect(session?.local.slice(11)).not.toBe(session?.utc.slice(11));
  });

  it("is one count for this UTC hour and day, with no device, IP address or user", async () => {
    await challenge();
    await challenge(deviceHeaders(DEVICE_B, "android"));
    expect(await siteRows()).toEqual([[hourKey(), today(), 2]]);
  });

  it("issues the 1,000th challenge in an hour and refuses the 1,001st, even from a phone it has never seen", async () => {
    await challenge();
    await setSiteCount(999);
    expect((await challenge(deviceHeaders(testDevice(1)))).status).toBe(201);
    const res = await challenge(deviceHeaders(testDevice(2)));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: { code: "rate_limited", message: ERROR_MESSAGES.rate_limited },
    });
    expect(await db.select().from(attestChallenges)).toHaveLength(2);
    expect(await siteRows()).toEqual([[hourKey(), today(), 1000]]);
    // The refusal spends none of the new phone's own allowance: only the first two phones have a count.
    expect(await db.select().from(rateLimits).where(eq(rateLimits.bucket, "attestation"))).toHaveLength(2);
  });

  it("starts again each UTC hour: another hour's full count, or this hour's yesterday, refuses nothing", async () => {
    const otherHour = hourKey((new Date().getUTCHours() + 1) % 24);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await db.insert(rateLimits).values([
      { deviceHash: otherHour, bucket: "attestation_site", windowStart: today(), count: 1000 },
      { deviceHash: hourKey(), bucket: "attestation_site", windowStart: yesterday, count: 1000 },
    ]);
    expect((await challenge()).status).toBe(201);
    expect((await siteRows()).sort()).toEqual(
      [
        [otherHour, today(), 1000],
        [hourKey(), yesterday, 1000],
        [hourKey(), today(), 1],
      ].sort(),
    );
  });
});
