import { V1MeetingDetailResponse } from "@mymeetingapp/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getMeeting } from "@/app/api/v1/meetings/[id]/route";
import { POST as tagMeeting } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { feeds, meetings } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import {
  findFeeds,
  findMeetings,
  listOptedOutFeeds,
  listTagOptOuts,
  MeetingOptOutForm,
  setFeedOptedOut,
  setMeetingTagsDisabled,
} from "@/server/admin/opt-outs";

import { resetDb } from "./db";
import { seedFeed } from "./feed-fixtures";
import { deviceHeaders, elsewhere, seedMeetingStarted } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

function tag(meetingId: string) {
  return tagMeeting(
    new Request("http://test/api/v1/tags", {
      method: "POST",
      headers: deviceHeaders(),
      body: JSON.stringify({ meetingId, tags: ["quiet"] }),
    }),
  );
}

async function detail(meetingId: string) {
  const res = await getMeeting(new Request(`http://test/api/v1/meetings/${meetingId}`), {
    params: Promise.resolve({ id: meetingId }),
  });
  return V1MeetingDetailResponse.parse(await res.json()).meeting;
}

describe("findMeetings", () => {
  it("matches the name, group name or address, taking % and _ literally", async () => {
    await seedMeetingStarted(1, { ...elsewhere(1), name: "100% Sober" });
    await seedMeetingStarted(1, { ...elsewhere(2), name: "1000 Club" });
    await seedMeetingStarted(1, { ...elsewhere(3), name: "Nooners", groupName: "Serenity Group" });
    expect((await findMeetings("100%")).map((meeting) => meeting.name)).toEqual(["100% Sober"]);
    expect((await findMeetings("serenity")).map((meeting) => meeting.name)).toEqual(["Nooners"]);
    expect((await findMeetings("2 Elm")).map((meeting) => meeting.name)).toEqual(["1000 Club"]);
    expect(await findMeetings("1_00")).toEqual([]);
  });
});

describe("setMeetingTagsDisabled (spec §3)", () => {
  it("turns tags off for a group, so none are accepted or shown, and back on", async () => {
    const meetingId = await seedMeetingStarted(1);
    expect((await tag(meetingId)).status).toBe(201);

    expect(await setMeetingTagsDisabled({ meetingId, tagsDisabled: true })).toBe("tags_turned_off");
    expect(await detail(meetingId)).toMatchObject({ tagsDisabled: true, tags: [] });
    const refused = await tag(meetingId);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "tags_disabled" } });
    expect((await listTagOptOuts()).map((meeting) => meeting.id)).toEqual([meetingId]);

    expect(await setMeetingTagsDisabled({ meetingId, tagsDisabled: false })).toBe("tags_turned_on");
    expect(await detail(meetingId)).toMatchObject({
      tagsDisabled: false,
      tags: [{ slug: "quiet", count: 1 }],
    });
    expect(await listTagOptOuts()).toEqual([]);
  });

  it("says so when the meeting no longer exists", async () => {
    expect(
      await setMeetingTagsDisabled({ meetingId: "0b6c9c1e-5f0a-4a57-9a51-1d8c2f0e7a11", tagsDisabled: true }),
    ).toBe("meeting_not_found");
  });
});

describe("MeetingOptOutForm", () => {
  it("reads the hidden fields", () => {
    expect(
      MeetingOptOutForm.parse({ meetingId: "0b6c9c1e-5f0a-4a57-9a51-1d8c2f0e7a11", tagsDisabled: "true" }),
    ).toEqual({ meetingId: "0b6c9c1e-5f0a-4a57-9a51-1d8c2f0e7a11", tagsDisabled: true });
    expect(
      MeetingOptOutForm.safeParse({ meetingId: "0b6c9c1e-5f0a-4a57-9a51-1d8c2f0e7a11", tagsDisabled: "yes" })
        .success,
    ).toBe(false);
  });
});

describe("feed opt-outs (spec §3, §4)", () => {
  it("finds a feed by name, slug or address", async () => {
    await seedFeed("knox-intergroup");
    await seedFeed("memphis-area", "area");
    expect((await findFeeds("knox")).map((feed) => feed.slug)).toEqual(["knox-intergroup"]);
    expect((await findFeeds("memphis-area.example.org")).map((feed) => feed.slug)).toEqual(["memphis-area"]);
  });

  it("opts a feed out, then back in, making it due for a full fetch", async () => {
    const feedId = await seedFeed("knox-intergroup");
    await db
      .update(feeds)
      .set({ lastSuccessAt: new Date(), lastAttemptAt: new Date() })
      .where(eq(feeds.id, feedId));

    expect(await setFeedOptedOut({ feedId, optedOut: true })).toBe("feed_opted_out");
    expect((await listOptedOutFeeds()).map((feed) => feed.slug)).toEqual(["knox-intergroup"]);

    expect(await setFeedOptedOut({ feedId, optedOut: false })).toBe("feed_opted_in");
    const [row] = await db
      .select({
        optedOut: feeds.optedOut,
        lastSuccessAt: feeds.lastSuccessAt,
        lastAttemptAt: feeds.lastAttemptAt,
      })
      .from(feeds)
      .where(eq(feeds.id, feedId));
    expect(row).toEqual({ optedOut: false, lastSuccessAt: null, lastAttemptAt: null });
  });

  it("says so when the feed no longer exists", async () => {
    expect(await setFeedOptedOut({ feedId: 999, optedOut: true })).toBe("feed_not_found");
  });
});

describe("archived meetings", () => {
  it("aren't offered by the search", async () => {
    const meetingId = await seedMeetingStarted(1);
    await db.update(meetings).set({ archivedAt: new Date() }).where(eq(meetings.id, meetingId));
    expect(await findMeetings("Nooners")).toEqual([]);
  });
});
