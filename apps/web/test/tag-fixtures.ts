import type { Platform } from "@mymeetingapp/shared";
import { asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { feedMeetings, meetings, tagCounts, tagSubmissions, tags } from "@/db/schema";
import type { FeedMeeting } from "@/server/feeds/normalize";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";
import { recomputeMeetings } from "@/server/meetings/recompute";
import { recountTags } from "@/server/tags/counts";
import { findTaggableMeeting } from "@/server/tags/taggable-meeting";

import { untilWaitingOnLock } from "./db";
import { feedMeeting, insertMeetingWithSources, seedFeed } from "./feed-fixtures";

let nextSubmitter = 1;

// Realistic raw ids: an iOS Keychain UUID and an ANDROID_ID. DEVICE_A_HASH is deviceHash("ios", DEVICE_A) under
// the test pepper, computed independently.
export const DEVICE_A = "6F9619FF-8B86-D011-B42D-00C04FC964FF";
export const DEVICE_A_HASH = "843ff89c9bc545aa6c2c749daa73a089752171a990aa930ce3aeb18c06ebffc4";
export const DEVICE_B = "3f2a9c8e1b7d4065";
// deviceHash("android", DEVICE_B) under the test pepper, computed independently.
export const DEVICE_B_HASH = "42d4e1645508213ac46e5e98a42c91c6b6336162a21b3afcd8112f6e7f5050ea";

// A distinct raw device id for the nth device in a test that needs many, valid under WriteHeaders' regex.
export function testDevice(n: number): string {
  return `test-device-${n.toString().padStart(6, "0")}`;
}

export function deviceHeaders(rawId = DEVICE_A, platform: Platform = "ios"): Record<string, string> {
  return { "X-Device-Id": rawId, "X-Platform": platform, "X-App-Version": "1.0.0" };
}

// A tag row written directly, for code that runs on stored rows (merging, counting, maintenance). The submitter id
// is an arbitrary 64-hex value unless one is given.
export async function insertSubmission(
  meetingId: string,
  slugs: string[],
  options: {
    nearMeeting?: boolean;
    confirmedAt?: Date;
    excluded?: boolean;
    scopeMeetingId?: string;
    submitterId?: string;
  } = {},
): Promise<string> {
  const rows = await db.select({ id: tags.id, slug: tags.slug }).from(tags).where(inArray(tags.slug, slugs));
  const tagIds = slugs.map((slug) => {
    const row = rows.find((candidate) => candidate.slug === slug);
    if (row === undefined) throw new Error(`no tag ${slug}; call seedVocabulary() first`);
    return row.id;
  });
  const submitterId = options.submitterId ?? (nextSubmitter++).toString(16).padStart(64, "0");
  await db.insert(tagSubmissions).values({
    meetingId,
    submitterId,
    scopeMeetingId: options.scopeMeetingId ?? meetingId,
    tagIds,
    nearMeeting: options.nearMeeting ?? false,
    confirmedAt: options.confirmedAt ?? new Date(),
    excluded: options.excluded ?? false,
  });
  return submitterId;
}

// A meeting's stored counts as [slug, device_count, verified_count], by slug.
export async function countsOf(meetingId: string) {
  const rows = await db
    .select({ slug: tags.slug, devices: tagCounts.deviceCount, verified: tagCounts.verifiedCount })
    .from(tagCounts)
    .innerJoin(tags, eq(tags.id, tagCounts.tagId))
    .where(eq(tagCounts.meetingId, meetingId))
    .orderBy(asc(tags.slug));
  return rows.map((row) => [row.slug, row.devices, row.verified]);
}

// Two stored copies of one meeting from two feeds, starting an hour ago in UTC (so inside the tagging window). The
// first is older, so a merge keeps it. Written directly, since the sync would have joined them.
export async function seedDuplicateCopies(): Promise<{ older: string; newer: string }> {
  const start = new Date(Date.now() - 3_600_000);
  const row = (sourceSlug: string) =>
    feedMeeting({
      sourceSlug,
      timezone: "UTC",
      day: start.getUTCDay(),
      time: start.toISOString().slice(11, 16),
    });
  const [a, b] = [await seedFeed("copy-a"), await seedFeed("copy-b")];
  const older = await insertMeetingWithSources([{ feedId: a, row: row("copy-a") }]);
  const newer = await insertMeetingWithSources([{ feedId: b, row: row("copy-b") }]);
  await db
    .update(meetings)
    .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
    .where(eq(meetings.id, older));
  await recomputeMeetings([older, newer]);
  return { older, newer };
}

export async function meetingIdOfSlug(sourceSlug: string): Promise<string> {
  const [row] = await db
    .select({ meetingId: feedMeetings.meetingId })
    .from(feedMeetings)
    .where(eq(feedMeetings.sourceSlug, sourceSlug));
  if (row === undefined) throw new Error(`no listing ${sourceSlug}`);
  return row.meetingId;
}

// A UTC meeting whose latest start was `hoursAgo` hours ago: open for tagging under 36, closed after.
export async function seedMeetingStarted(
  hoursAgo: number,
  overrides: Partial<FeedMeeting> = {},
): Promise<string> {
  const start = new Date(Date.now() - hoursAgo * 3_600_000);
  const row = feedMeeting({
    timezone: "UTC",
    day: start.getUTCDay(),
    time: start.toISOString().slice(11, 16),
    ...overrides,
  });
  await applyFeedSnapshot(await seedFeed(`feed-${row.sourceSlug}`), [row]);
  return meetingIdOfSlug(row.sourceSlug);
}

// A place far from every other seeded meeting, so meetings at the same time never match each other.
export function elsewhere(n: number): Partial<FeedMeeting> {
  return {
    sourceSlug: `meeting-${String(n)}`,
    formattedAddress: `${String(n)} Elm St, Nashville, TN 37203, USA`,
    addressKey: `${String(n)} elm st nashville tn 37203`,
    latitude: 30 + n * 0.1,
    longitude: -90,
  };
}

// Runs `during` while another tag write on the meeting sits uncommitted just after its recount, as POST /tags
// leaves it before committing, and lets that write commit once `during` waits on one of its locks.
export async function whileTagWriteHolds<T>(meetingId: string, during: () => Promise<T>): Promise<T> {
  let release: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => (release = resolve));
  let ready: () => void = () => undefined;
  const writeReady = new Promise<void>((resolve) => (ready = resolve));
  const write = db.transaction(async (tx) => {
    await findTaggableMeeting(meetingId, tx);
    await recountTags([meetingId], tx);
    ready();
    await hold;
  });
  await writeReady;
  let settled = false;
  const pending = during().finally(() => (settled = true));
  await untilWaitingOnLock(() => settled);
  release();
  await write;
  return pending;
}
