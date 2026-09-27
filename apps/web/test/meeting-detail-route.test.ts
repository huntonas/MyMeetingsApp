import { MeetingDetailResponse } from "@mymeetingapp/shared";
import { isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/v1/meetings/[id]/route";
import { db, pool } from "@/db/client";
import { feedMeetings, meetings } from "@/db/schema";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";

import { resetDb } from "./db";
import { feedMeeting, seedFeed } from "./feed-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

function get(id: string) {
  return GET(new Request(`http://test/api/v1/meetings/${id}`), { params: Promise.resolve({ id }) });
}

async function onlyMeetingId() {
  const [row] = await db.select({ id: meetings.id }).from(meetings).where(isNull(meetings.archivedAt));
  return row?.id ?? "";
}

describe("GET /api/v1/meetings/:id", () => {
  it("returns the meeting from its primary source, cacheable for five minutes", async () => {
    await applyFeedSnapshot(await seedFeed("a"), [
      feedMeeting({ notes: "Use the side door", types: ["O", "BE"] }),
    ]);
    const id = await onlyMeetingId();
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=600");
    expect(MeetingDetailResponse.parse(await res.json()).meeting).toEqual({
      id,
      name: "Nooners",
      day: 1,
      time: "12:00",
      endTime: null,
      timezone: "America/Chicago",
      types: ["O", "BE"],
      attendance: "in_person",
      locationName: "St. Luke's",
      formattedAddress: "1 Main St, Nashville, TN 37203, USA",
      latitude: 36.17,
      longitude: -86.78,
      locationNotes: null,
      notes: "Use the side door",
      groupName: null,
      conferenceUrl: null,
      conferenceUrlNotes: null,
      conferencePhone: null,
      conferencePhoneNotes: null,
      sourceUrl: null,
    });
  });

  it("returns meeting_not_found for an archived meeting", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting()]);
    const id = await onlyMeetingId();
    await db.update(feedMeetings).set({ archivedAt: new Date() });
    await applyFeedSnapshot(feedId, []);
    const res = await get(id);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "meeting_not_found" } });
  });

  it("returns meeting_not_found for an unknown id and invalid_request for a malformed one", async () => {
    expect((await get("0f8fad5b-d9cb-469f-a165-70867728950e")).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(400);
  });
});
