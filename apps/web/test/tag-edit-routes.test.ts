import { MeetingDetailResponse, TagWriteResponse } from "@mymeetingapp/shared";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getMeeting } from "@/app/api/v1/meetings/[id]/route";
import { DELETE, PUT } from "@/app/api/v1/tags/[meetingId]/route";
import { POST } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { devices, meetings, rateLimits, tagAudit, tagSubmissions } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { foldDeviceDays } from "@/server/devices/device-days";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";
import { mergeDuplicateMeetings } from "@/server/meetings/merge";

import { resetDb } from "./db";
import { feedMeeting, seedFeed } from "./feed-fixtures";
import {
  DEVICE_A_HASH,
  DEVICE_B,
  deviceHeaders,
  elsewhere,
  meetingIdOfSlug,
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

function post(meetingId: string, tags: string[], headers = deviceHeaders(), nearMeeting = false) {
  return POST(
    new Request("http://test/api/v1/tags", {
      method: "POST",
      headers,
      body: JSON.stringify({ meetingId, tags, nearMeeting }),
    }),
  );
}

function put(meetingId: string, tags: string[], headers = deviceHeaders()) {
  return PUT(
    new Request(`http://test/api/v1/tags/${meetingId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ tags }),
    }),
    { params: Promise.resolve({ meetingId }) },
  );
}

function del(meetingId: string, headers = deviceHeaders()) {
  return DELETE(new Request(`http://test/api/v1/tags/${meetingId}`, { method: "DELETE", headers }), {
    params: Promise.resolve({ meetingId }),
  });
}

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(await res.json()).toMatchObject({ error: { code } });
}

// Closes the meeting's tagging window by taking away its time zone.
async function closeWindow(meetingId: string) {
  await db.update(meetings).set({ timezone: null }).where(eq(meetings.id, meetingId));
}

describe("PUT /api/v1/tags/:meetingId", () => {
  it("replaces the device's tags after the window closes, keeping confirmed_at and near_meeting", async () => {
    const meetingId = await seedMeetingStarted(1);
    await post(meetingId, ["laid-back"], deviceHeaders(), true);
    const [before] = await db.select().from(tagSubmissions);
    await closeWindow(meetingId);
    const res = await put(meetingId, ["quiet", "coffee"]);
    expect(res.status).toBe(200);
    expect(TagWriteResponse.parse(await res.json())).toEqual({
      meetingId,
      tags: [
        { slug: "quiet", count: 1 },
        { slug: "coffee", count: 1 },
      ],
    });
    const [after] = await db.select().from(tagSubmissions);
    expect([after?.confirmedAt, after?.nearMeeting]).toEqual([before?.confirmedAt, true]);
    expect((await db.select().from(rateLimits))[0]?.count).toBe(1);
  });

  it("refuses a device that hasn't tagged the meeting", async () => {
    const meetingId = await seedMeetingStarted(1);
    await post(meetingId, ["quiet"]);
    await expectError(
      await put(meetingId, ["lively"], deviceHeaders(DEVICE_B, "android")),
      404,
      "not_tagged",
    );
  });

  it("checks the tags like a new submission", async () => {
    const meetingId = await seedMeetingStarted(1);
    await post(meetingId, ["quiet"]);
    await expectError(await put(meetingId, ["great-vibes"]), 400, "unknown_tag");
    const seven = [
      "by-the-book",
      "laid-back",
      "speaker-heavy",
      "lots-of-sharing",
      "step-study",
      "quiet",
      "coffee",
    ];
    await expectError(await put(meetingId, seven), 400, "too_many_tags");
  });

  it("refuses an edit to two sizes, keeping the tags already there", async () => {
    const meetingId = await seedMeetingStarted(1);
    await post(meetingId, ["quiet", "size-small"]);
    const res = await put(meetingId, ["size-small", "size-very-large"]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "one_size", message: "Choose one size." } });
    expect((await put(meetingId, ["size-very-large"])).status).toBe(200);
  });

  it("is refused while tagging is switched off, for an opted-out meeting, and for a blocked device", async () => {
    const meetingId = await seedMeetingStarted(1);
    await post(meetingId, ["quiet"]);
    vi.stubEnv("FEATURE_TAGGING", "off");
    await expectError(await put(meetingId, ["lively"]), 403, "tags_disabled");
    vi.stubEnv("FEATURE_TAGGING", "on");
    await db.update(meetings).set({ tagsDisabled: true });
    await expectError(await put(meetingId, ["lively"]), 403, "tags_disabled");
    await db.update(meetings).set({ tagsDisabled: false });
    await foldDeviceDays();
    await db.update(devices).set({ blocked: true });
    await expectError(await put(meetingId, ["lively"]), 403, "device_blocked");
  });

  it("edits a row keyed by a merged-away meeting and collapses duplicates", async () => {
    const { older, newer } = await seedDuplicateCopies();
    await post(older, ["quiet"]);
    await post(newer, ["quiet"]);
    await db.transaction((tx) => mergeDuplicateMeetings([newer], tx));
    expect(await db.select().from(tagSubmissions)).toHaveLength(2);
    const res = await put(newer, ["lively"]);
    expect(TagWriteResponse.parse(await res.json())).toEqual({
      meetingId: older,
      tags: [{ slug: "lively", count: 1 }],
    });
    const rows = await db.select().from(tagSubmissions);
    expect(rows.map((row) => [row.meetingId, row.scopeMeetingId])).toEqual([[older, older]]);
  });
});

describe("DELETE /api/v1/tags/:meetingId", () => {
  it("removes the device's row and its audit rows for the meeting, and returns the updated counts", async () => {
    const meetingId = await seedMeetingStarted(1);
    await post(meetingId, ["quiet"]);
    await post(meetingId, ["quiet"], deviceHeaders(DEVICE_B, "android"));
    const res = await del(meetingId);
    expect(TagWriteResponse.parse(await res.json())).toEqual({
      meetingId,
      tags: [{ slug: "quiet", count: 1 }],
    });
    expect(await db.select().from(tagSubmissions)).toHaveLength(1);
    expect(await db.select().from(tagAudit).where(eq(tagAudit.deviceHash, DEVICE_A_HASH))).toEqual([]);
    await expectError(await del(meetingId), 404, "not_tagged");
  });

  it("works while tagging is switched off, for an opted-out or archived meeting, and for a blocked device", async () => {
    const meetingId = await seedMeetingStarted(1);
    await post(meetingId, ["quiet"]);
    vi.stubEnv("FEATURE_TAGGING", "off");
    await db.update(meetings).set({ tagsDisabled: true, archivedAt: new Date() });
    await foldDeviceDays();
    await db.update(devices).set({ blocked: true });
    expect((await del(meetingId)).status).toBe(200);
    expect(await db.select().from(tagSubmissions)).toEqual([]);
  });

  it("finds the row of a copy that merged away", async () => {
    const { older, newer } = await seedDuplicateCopies();
    await post(newer, ["quiet"]);
    await db.transaction((tx) => mergeDuplicateMeetings([newer], tx));
    expect(TagWriteResponse.parse(await (await del(older)).json())).toEqual({ meetingId: older, tags: [] });
  });
});

// Spec §5 allows deletes at any time and §2 puts privacy first, so an app too old to write can still delete. The
// device is still identified the same way, so a forged id can't delete another device's tags.
describe("DELETE and the device checks", () => {
  it("works below the minimum app version, while PUT asks for an upgrade", async () => {
    const meetingId = await seedMeetingStarted(1);
    await post(meetingId, ["quiet"]);
    vi.stubEnv("MIN_VERSION_IOS", "1.2.0");
    await expectError(await put(meetingId, ["lively"]), 426, "upgrade_required");
    expect((await del(meetingId)).status).toBe(200);
    expect(await db.select().from(tagSubmissions)).toEqual([]);
  });

  it("still checks the device headers and attestation", async () => {
    const meetingId = await seedMeetingStarted(1);
    await post(meetingId, ["quiet"]);
    await expectError(
      await del(meetingId, { ...deviceHeaders(), "X-Device-Id": "abc" }),
      400,
      "invalid_request",
    );
    vi.stubEnv("REQUIRE_ATTESTATION", "on");
    await expectError(
      await del(meetingId, { ...deviceHeaders(), "X-Attestation": "forged" }),
      401,
      "attestation_failed",
    );
    expect(await db.select().from(tagSubmissions)).toHaveLength(1);
  });
});

describe("a tagged meeting the feed sync merges away", () => {
  it("keeps the device's tags reachable by the old id", async () => {
    const start = new Date(Date.now() - 3_600_000);
    const listing = (sourceSlug: string, overrides: Parameters<typeof feedMeeting>[0] = {}) =>
      feedMeeting({
        timezone: "UTC",
        day: start.getUTCDay(),
        time: start.toISOString().slice(11, 16),
        ...overrides,
        sourceSlug,
      });
    const [a, b] = [await seedFeed("a"), await seedFeed("b")];
    await applyFeedSnapshot(a, [listing("a")]);
    await applyFeedSnapshot(b, [listing("b", elsewhere(1))]);
    const [older, newer] = [await meetingIdOfSlug("a"), await meetingIdOfSlug("b")];
    expect(newer).not.toBe(older);
    expect((await post(newer, ["quiet"])).status).toBe(201);

    // Feed b moves its listing to feed a's address, so this sync merges the newer meeting into the older.
    await applyFeedSnapshot(b, [listing("b")]);
    expect(await meetingIdOfSlug("b")).toBe(older);

    await expectError(await post(older, ["lively"]), 409, "already_tagged");
    const edited = await put(newer, ["lively"]);
    expect(edited.status).toBe(200);
    expect(TagWriteResponse.parse(await edited.json())).toEqual({
      meetingId: older,
      tags: [{ slug: "lively", count: 1 }],
    });
    const detail = await getMeeting(new Request(`http://test/api/v1/meetings/${newer}`), {
      params: Promise.resolve({ id: newer }),
    });
    expect(detail.status).toBe(200);
    expect(MeetingDetailResponse.parse(await detail.json()).meeting.id).toBe(older);
    const deleted = await del(newer);
    expect(deleted.status).toBe(200);
    expect(TagWriteResponse.parse(await deleted.json())).toEqual({ meetingId: older, tags: [] });
    expect(await db.select().from(tagSubmissions)).toEqual([]);
  });
});
