import { MeetingSearchResponse } from "@mymeetingapp/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { format } from "node:util";

import { POST } from "@/app/api/v1/meetings/search/route";
import { db, pool } from "@/db/client";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";

import { resetDb } from "./db";
import { feedMeeting, seedFeed } from "./feed-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

function search(body: unknown) {
  return POST(
    new Request("http://test/api/v1/meetings/search", { method: "POST", body: JSON.stringify(body) }),
  );
}

async function seedNashville() {
  const feedId = await seedFeed("a");
  await applyFeedSnapshot(feedId, [
    feedMeeting({ sourceSlug: "near", addressKey: "near", latitude: 36.17, longitude: -86.78 }),
    feedMeeting({
      sourceSlug: "hybrid",
      addressKey: "hybrid",
      latitude: 36.3,
      longitude: -86.78,
      attendance: "hybrid",
      conferenceUrl: "https://zoom.us/j/9",
    }),
    feedMeeting({ sourceSlug: "far", addressKey: "far", latitude: 37.5, longitude: -86.78 }),
    feedMeeting({
      sourceSlug: "online",
      attendance: "online",
      formattedAddress: null,
      addressKey: null,
      latitude: null,
      longitude: null,
      conferenceUrl: "https://zoom.us/j/1",
    }),
  ]);
}

describe("POST /api/v1/meetings/search", () => {
  it("returns in-person and hybrid meetings in the radius, nearest first, never cached", async () => {
    await seedNashville();
    const res = await search({ lat: 36.16, lng: -86.78, radiusKm: 25 });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { meetings } = MeetingSearchResponse.parse(await res.json());
    expect(meetings.map((m) => [m.attendance, m.distanceKm > 0])).toEqual([
      ["in_person", true],
      ["hybrid", true],
    ]);
    expect(meetings[0]?.distanceKm).toBe(1.1);
    expect(meetings[1]?.distanceKm).toBeCloseTo(15.5, 0);
  });

  it("leaves out archived meetings", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting()]);
    await applyFeedSnapshot(feedId, []);
    const { meetings } = MeetingSearchResponse.parse(
      await (await search({ lat: 36.16, lng: -86.78, radiusKm: 25 })).json(),
    );
    expect(meetings).toEqual([]);
  });

  it("leaves out an online meeting even when it has coordinates", async () => {
    await applyFeedSnapshot(await seedFeed("a"), [
      // A temporarily closed venue: its address and pin remain, but the meeting is on Zoom.
      feedMeeting({ attendance: "online", conferenceUrl: "https://zoom.us/j/5" }),
    ]);
    const { meetings } = MeetingSearchResponse.parse(
      await (await search({ lat: 36.16, lng: -86.78, radiusKm: 25 })).json(),
    );
    expect(meetings).toEqual([]);
  });

  it("returns at most 1000 meetings", async () => {
    const feedId = await seedFeed("a");
    await db.execute(sql`
      insert into meetings (day, time, latitude, longitude)
      select 1, '12:00', 36.16 + n / 100000.0, -86.78 from generate_series(1, 1001) as n
    `);
    await db.execute(sql`
      insert into feed_meetings (feed_id, meeting_id, source_slug, day, time, name, types, attendance, seen_at)
      select ${feedId}, id, id::text, 1, '12:00', 'Meeting', '{}', 'in_person', now() from meetings
    `);
    await db.execute(sql`
      update meetings m set primary_feed_meeting_id = fm.id from feed_meetings fm where fm.meeting_id = m.id
    `);
    const { meetings } = MeetingSearchResponse.parse(
      await (await search({ lat: 36.16, lng: -86.78, radiusKm: 25 })).json(),
    );
    expect(meetings).toHaveLength(1000);
  });

  it.each([
    { lat: 36.1627, lng: -86.7816, radiusKm: 25 },
    { lat: 36.16, lng: -86.78 },
    { lat: "36.16", lng: -86.78, radiusKm: 25 },
  ])("rejects %j without logging it", async (body) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await search(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(log.mock.calls.map((args) => format(...args)).join("\n")).not.toContain("36.16");
    log.mockRestore();
  });
});
