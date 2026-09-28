import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { meetingAliases, meetings, tagAudit, tagCounts, tagSubmissions } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";
import { mergeDuplicateMeetings } from "@/server/meetings/merge";
import { recomputeMeetings } from "@/server/meetings/recompute";
import { recountTags } from "@/server/tags/counts";

import { resetDb, untilWaitingOnLock } from "./db";
import { feedMeeting, insertMeetingWithSources, seedFeed } from "./feed-fixtures";
import { countsOf, insertSubmission, meetingIdOfSlug, seedDuplicateCopies } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

const DAY_MS = 86_400_000;

async function aliases() {
  const rows = await db.select().from(meetingAliases);
  return rows.map((row) => [row.oldMeetingId, row.meetingId]).sort();
}

describe("recountTags", () => {
  it("counts a row that lists a tag twice once", async () => {
    const { older: meetingId } = await seedDuplicateCopies();
    await insertSubmission(meetingId, ["quiet", "quiet"], { nearMeeting: true });
    await recountTags([meetingId], db);
    expect(await countsOf(meetingId)).toEqual([["quiet", 1, 1]]);
  });

  it("counts non-excluded submissions confirmed in the last 180 days, and how many were near the meeting", async () => {
    const { older: meetingId } = await seedDuplicateCopies();
    await insertSubmission(meetingId, ["laid-back", "welcoming"], { nearMeeting: true });
    await insertSubmission(meetingId, ["laid-back"]);
    await insertSubmission(meetingId, ["laid-back"], { excluded: true });
    await insertSubmission(meetingId, ["welcoming"], { confirmedAt: new Date(Date.now() - 181 * DAY_MS) });
    await recountTags([meetingId], db);
    expect(await countsOf(meetingId)).toEqual([
      ["laid-back", 2, 1],
      ["welcoming", 1, 1],
    ]);
  });

  it("removes a meeting's counts when none of its submissions count any more", async () => {
    const { older: meetingId } = await seedDuplicateCopies();
    await insertSubmission(meetingId, ["quiet"]);
    await recountTags([meetingId], db);
    await db.update(tagSubmissions).set({ excluded: true });
    await recountTags([meetingId], db);
    expect(await countsOf(meetingId)).toEqual([]);
  });
});

describe("tags across a merge", () => {
  it("moves the merged meeting's submissions, audit rows and opt-out to the survivor and records an alias", async () => {
    const { older, newer } = await seedDuplicateCopies();
    await insertSubmission(older, ["laid-back"]);
    await insertSubmission(newer, ["laid-back", "quiet"], { nearMeeting: true });
    await insertSubmission(newer, ["quiet"]);
    await db.insert(tagAudit).values({ deviceHash: "a".repeat(64), meetingId: newer, action: "submit" });
    await db.update(meetings).set({ tagsDisabled: true }).where(eq(meetings.id, newer));
    await recountTags([older, newer], db);

    await mergeDuplicateMeetings([newer], db);

    const rows = await db.select().from(tagSubmissions);
    expect(rows.map((row) => row.meetingId)).toEqual([older, older, older]);
    expect(rows.map((row) => row.scopeMeetingId).sort()).toEqual([newer, newer, older].sort());
    expect(await countsOf(older)).toEqual([
      ["laid-back", 2, 1],
      ["quiet", 2, 1],
    ]);
    expect(await db.select().from(tagCounts).where(eq(tagCounts.meetingId, newer))).toEqual([]);
    expect(await aliases()).toEqual([[newer, older]]);
    expect((await db.select({ meetingId: tagAudit.meetingId }).from(tagAudit))[0]?.meetingId).toBe(older);
    const [survivor] = await db.select().from(meetings).where(eq(meetings.id, older));
    expect(survivor?.tagsDisabled).toBe(true);
  });

  it("points every alias straight at the latest survivor when a survivor merges again", async () => {
    const [a, b, c] = [await seedFeed("a"), await seedFeed("b"), await seedFeed("c")];
    const middle = await insertMeetingWithSources([{ feedId: b, row: feedMeeting({ sourceSlug: "b" }) }]);
    const newest = await insertMeetingWithSources([{ feedId: a, row: feedMeeting({ sourceSlug: "a" }) }]);
    await db
      .update(meetings)
      .set({ createdAt: new Date("2026-02-01T00:00:00Z") })
      .where(eq(meetings.id, middle));
    await recomputeMeetings([middle, newest]);
    await mergeDuplicateMeetings([newest], db);
    const oldest = await insertMeetingWithSources([{ feedId: c, row: feedMeeting({ sourceSlug: "c" }) }]);
    await db
      .update(meetings)
      .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(meetings.id, oldest));
    await recomputeMeetings([oldest]);
    await insertSubmission(middle, ["coffee"], { scopeMeetingId: newest });

    await mergeDuplicateMeetings([oldest], db);

    expect(await aliases()).toEqual(
      [
        [middle, oldest],
        [newest, oldest],
      ].sort(),
    );
    expect(await countsOf(oldest)).toEqual([["coffee", 1, 0]]);
  });
});

describe("tags across a split", () => {
  it("stay on the meeting that keeps the primary listing", async () => {
    const [a, b] = [await seedFeed("a"), await seedFeed("b")];
    const men = feedMeeting({ sourceSlug: "men", name: "Big Book", types: ["M"] });
    const women = feedMeeting({ sourceSlug: "women", name: "Big Book", types: ["W"] });
    const meetingId = await insertMeetingWithSources([
      { feedId: a, row: men },
      { feedId: b, row: women },
    ]);
    await recomputeMeetings([meetingId]);
    await insertSubmission(meetingId, ["welcoming"]);
    await recountTags([meetingId], db);

    await applyFeedSnapshot(b, [women]);

    const splitOff = await meetingIdOfSlug("women");
    expect(splitOff).not.toBe(meetingId);
    expect(await meetingIdOfSlug("men")).toBe(meetingId);
    expect(await countsOf(meetingId)).toEqual([["welcoming", 1, 0]]);
    expect(await countsOf(splitOff)).toEqual([]);
    expect(await aliases()).toEqual([]);
  });
});

describe("mergeDuplicateMeetings racing a tag write", () => {
  it("waits for a write holding a meeting it merges, then carries the row that write added", async () => {
    const { older, newer } = await seedDuplicateCopies();
    // Stands in for POST /tags, which holds its meeting row (findTaggableMeeting) until it commits.
    const write = await pool.connect();
    await write.query("begin");
    await write.query("select 1 from meetings where id = $1 for share", [newer]);
    let settled = false;
    const merge = db.transaction((tx) => mergeDuplicateMeetings([newer], tx)).finally(() => (settled = true));
    await untilWaitingOnLock(() => settled);
    await write.query(
      `insert into tag_submissions (meeting_id, submitter_id, scope_meeting_id, tag_ids, near_meeting)
       select $1, repeat('a', 64), $1, array[id], false from tags where slug = 'quiet'`,
      [newer],
    );
    await write.query("commit");
    write.release();
    await merge;
    const rows = await db.select().from(tagSubmissions);
    expect(rows.map((row) => row.meetingId)).toEqual([older]);
  });
});
