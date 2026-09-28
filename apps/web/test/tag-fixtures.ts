import { asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { feedMeetings, meetings, tagCounts, tagSubmissions, tags } from "@/db/schema";
import { recomputeMeetings } from "@/server/meetings/recompute";

import { feedMeeting, insertMeetingWithSources, seedFeed } from "./feed-fixtures";

let nextSubmitter = 1;

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
