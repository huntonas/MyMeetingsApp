import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { devices, feeds, suggestions, tagSwings, tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { utcToday } from "@/db/sql";
import { readFeedsNeedingAttention, readMetrics } from "@/server/admin/metrics";
import { recountTags } from "@/server/tags/counts";

import { resetDb } from "./db";
import { seedFeed } from "./feed-fixtures";
import { elsewhere, insertSubmission, seedMeetingStarted } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const utcDate = (date: Date) => date.toISOString().slice(0, 10);

async function device(n: number, platform: "ios" | "android", lastSeenDaysAgo: number, blocked = false) {
  const day = sql`${utcToday} - ${lastSeenDaysAgo}::int`;
  await db.insert(devices).values({
    deviceHash: n.toString(16).padStart(64, "0"),
    platform,
    firstSeenDate: day,
    lastSeenDate: day,
    blocked,
  });
}

async function tagId(slug: string): Promise<number> {
  const [row] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug));
  if (row === undefined) throw new Error(`no tag ${slug}`);
  return row.id;
}

async function feedState(slug: string, state: Partial<typeof feeds.$inferInsert>) {
  await seedFeed(slug);
  if (Object.keys(state).length > 0) await db.update(feeds).set(state).where(eq(feeds.slug, slug));
}

describe("readMetrics (spec §10: totals only)", () => {
  it("counts phones active in the last 7 and 30 UTC days, by platform, and blocked ones", async () => {
    await device(1, "ios", 0);
    await device(2, "android", 6);
    await device(3, "ios", 7);
    await device(4, "ios", 29);
    await device(5, "android", 30, true);
    expect((await readMetrics()).devices).toEqual({
      active7: 2,
      active30: 4,
      ios: 3,
      android: 2,
      blocked: 1,
    });
  });

  it("counts this week's tagging, meetings with tags, submissions per day and top tags", async () => {
    const meetingId = await seedMeetingStarted(1);
    await seedMeetingStarted(1, elsewhere(1));
    await insertSubmission(meetingId, ["quiet", "coffee"], { nearMeeting: true });
    await insertSubmission(meetingId, ["quiet"]);
    await insertSubmission(meetingId, ["quiet"], { confirmedAt: daysAgo(8) });
    await insertSubmission(meetingId, ["lively"], { excluded: true });
    await recountTags([meetingId], db);

    const metrics = await readMetrics();
    expect(metrics.tagging).toEqual({
      submissionsThisWeek: 2,
      nearMeetingThisWeek: 1,
      meetings: 2,
      meetingsWithTags: 1,
    });
    expect(metrics.topTags).toEqual([
      { label: "Quiet", submissions: 3 },
      { label: "Coffee", submissions: 1 },
    ]);
    expect(metrics.submissionsPerDay).toHaveLength(14);
    expect(metrics.submissionsPerDay.at(-1)).toEqual({ day: utcDate(new Date()), count: 2 });
    expect(metrics.submissionsPerDay.at(-9)).toEqual({ day: utcDate(daysAgo(8)), count: 1 });
    expect(metrics.submissionsPerDay.at(-2)).toEqual({ day: utcDate(daysAgo(1)), count: 0 });
  });

  it("counts the vocabulary, pending suggestions and open swing flags", async () => {
    await db.update(tags).set({ status: "retired" }).where(eq(tags.slug, "quiet"));
    await db
      .insert(suggestions)
      .values([
        { text: "Relaxed" },
        { text: "Big print books" },
        { text: "Loud", status: "rejected", reviewedAt: new Date() },
      ]);
    const meetingId = await seedMeetingStarted(1);
    await db.insert(tagSwings).values([
      { meetingId, tagId: await tagId("lively"), newDevices: 5, priorDevices: 0 },
      { meetingId, tagId: await tagId("coffee"), newDevices: 6, priorDevices: 1, reviewedAt: new Date() },
    ]);
    expect(await readMetrics()).toMatchObject({
      vocabulary: { active: 25, retired: 1 },
      pendingSuggestions: 2,
      openSwings: 1,
    });
  });
});

describe("feed health (owner decision 1)", () => {
  it("lists feeds whose last attempt failed or that haven't succeeded in 8 days, oldest success first", async () => {
    await feedState("healthy", { lastAttemptAt: new Date(), lastSuccessAt: new Date() });
    await feedState("failing", {
      lastAttemptAt: new Date(),
      lastSuccessAt: daysAgo(3),
      lastError: "HTTP 503",
    });
    await feedState("overdue", { lastAttemptAt: daysAgo(1), lastSuccessAt: daysAgo(9) });
    await feedState("brand-new", {});
    await feedState("opted-out", { optedOut: true, lastAttemptAt: new Date(), lastError: "HTTP 404" });
    await feedState("never-worked", { lastAttemptAt: new Date(), lastError: "not a JSON array" });

    expect((await readFeedsNeedingAttention()).map((feed) => [feed.slug, feed.lastError])).toEqual([
      ["never-worked", "not a JSON array"],
      ["overdue", null],
      ["failing", "HTTP 503"],
    ]);
    expect((await readMetrics()).feeds).toEqual({ total: 6, optedOut: 1, needingAttention: 3 });
  });

  // Owner decision 1: the overdue window is the weekly sync plus its one-day retry, exactly 8 days. A feed just
  // inside that window (still due for its ordinary retry, but not yet overdue) must not be flagged.
  it("does not list a feed that succeeded 7 days ago with no error", async () => {
    await feedState("on-schedule", { lastAttemptAt: daysAgo(1), lastSuccessAt: daysAgo(7) });
    expect(await readFeedsNeedingAttention()).toEqual([]);
  });

  it("cuts a long error to 300 characters", async () => {
    await feedState("noisy", { lastAttemptAt: new Date(), lastError: "x".repeat(5000) });
    const [noisy] = await readFeedsNeedingAttention();
    expect(noisy?.lastError).toHaveLength(300);
  });
});
