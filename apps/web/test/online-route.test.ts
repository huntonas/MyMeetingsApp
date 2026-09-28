import { OnlineMeetingsResponse } from "@mymeetingapp/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/v1/meetings/online/route";
import { db, pool } from "@/db/client";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";
import { recountTags } from "@/server/tags/counts";

import { resetDb } from "./db";
import { feedMeeting, seedFeed } from "./feed-fixtures";
import { insertSubmission } from "./tag-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

const online = {
  attendance: "online",
  formattedAddress: null,
  addressKey: null,
  latitude: null,
  longitude: null,
} as const;

function get(query: string) {
  return GET(new Request(`http://test/api/v1/meetings/online${query}`));
}

describe("GET /api/v1/meetings/online", () => {
  it("returns that day's online and hybrid meetings by time, cacheable for 15 minutes", async () => {
    await applyFeedSnapshot(await seedFeed("a"), [
      feedMeeting({
        ...online,
        sourceSlug: "late",
        time: "20:00",
        name: "Late",
        conferenceUrl: "https://zoom.us/j/2",
      }),
      feedMeeting({
        ...online,
        sourceSlug: "early",
        time: "07:00",
        name: "Early",
        conferencePhone: "+1 555 0100",
      }),
      feedMeeting({
        sourceSlug: "hybrid",
        time: "12:00",
        name: "Hybrid",
        attendance: "hybrid",
        conferenceUrl: "https://zoom.us/j/3",
      }),
      feedMeeting({ sourceSlug: "in-person", time: "09:00", name: "In person" }),
      feedMeeting({ ...online, sourceSlug: "other-day", day: 2, conferenceUrl: "https://zoom.us/j/4" }),
    ]);
    const res = await get("?day=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=900, stale-while-revalidate=3600");
    expect(OnlineMeetingsResponse.parse(await res.json()).meetings.map((m) => m.name)).toEqual([
      "Early",
      "Hybrid",
      "Late",
    ]);
  });

  it("leaves out archived meetings", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting({ ...online, conferenceUrl: "https://zoom.us/j/1" })]);
    await applyFeedSnapshot(feedId, []);
    expect(OnlineMeetingsResponse.parse(await (await get("?day=1")).json()).meetings).toEqual([]);
  });

  it("includes each meeting's tag counts", async () => {
    await seedVocabulary();
    await applyFeedSnapshot(await seedFeed("a"), [
      feedMeeting({ ...online, sourceSlug: "early", time: "07:00", name: "Early" }),
    ]);
    const before = OnlineMeetingsResponse.parse(await (await get("?day=1")).json()).meetings;
    const id = before[0]?.id ?? "";
    await insertSubmission(id, ["lively"]);
    await recountTags([id], db);
    const [first] = OnlineMeetingsResponse.parse(await (await get("?day=1")).json()).meetings;
    expect(first?.tags).toEqual([{ slug: "lively", count: 1 }]);
  });

  it.each(["", "?day=7", "?day=monday"])("rejects %j", async (query) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
  });
});
