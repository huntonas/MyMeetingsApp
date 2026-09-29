import { MeetingDetailResponse, VocabularyResponse } from "@mymeetingapp/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getMeeting } from "@/app/api/v1/meetings/[id]/route";
import { GET as getVocabulary } from "@/app/api/v1/vocabulary/route";
import { db, pool } from "@/db/client";
import { tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { listVocabulary, setTagRetired } from "@/server/admin/vocabulary";
import { recountTags } from "@/server/tags/counts";

import { resetDb } from "./db";
import { countsOf, insertSubmission, seedMeetingStarted } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

async function quiet() {
  const [row] = await db.select().from(tags).where(eq(tags.slug, "quiet"));
  if (row === undefined) throw new Error("no quiet tag");
  return row;
}

async function vocabularySlugs(): Promise<string[]> {
  const res = await getVocabulary(new Request("http://test/api/v1/vocabulary"));
  return VocabularyResponse.parse(await res.json()).tags.map((tag) => tag.slug);
}

async function meetingTags(meetingId: string) {
  const res = await getMeeting(new Request(`http://test/api/v1/meetings/${meetingId}`), {
    params: Promise.resolve({ id: meetingId }),
  });
  return MeetingDetailResponse.parse(await res.json()).meeting.tags;
}

async function taggedQuietly(): Promise<string> {
  const meetingId = await seedMeetingStarted(1);
  await insertSubmission(meetingId, ["quiet"]);
  await recountTags([meetingId], db);
  return meetingId;
}

describe("setTagRetired (spec §5: retired, never deleted)", () => {
  it("hides a retired tag from the app, keeping its row and its counts", async () => {
    const meetingId = await taggedQuietly();
    expect(await setTagRetired({ tagId: (await quiet()).id, retired: true })).toBe("tag_retired");
    expect(await vocabularySlugs()).not.toContain("quiet");
    expect(await meetingTags(meetingId)).toEqual([]);
    expect(await countsOf(meetingId)).toEqual([["quiet", 1, 0]]);
    expect(await quiet()).toMatchObject({ status: "retired" });
  });

  it("restores it with its counts", async () => {
    const meetingId = await taggedQuietly();
    await setTagRetired({ tagId: (await quiet()).id, retired: true });
    expect(await setTagRetired({ tagId: (await quiet()).id, retired: false })).toBe("tag_restored");
    expect(await vocabularySlugs()).toContain("quiet");
    expect(await meetingTags(meetingId)).toEqual([{ slug: "quiet", count: 1 }]);
  });

  it("says so when the tag doesn't exist", async () => {
    expect(await setTagRetired({ tagId: 999, retired: true })).toBe("tag_not_found");
  });
});

describe("listVocabulary", () => {
  it("lists every tag, retired ones included, in vocabulary order", async () => {
    await setTagRetired({ tagId: (await quiet()).id, retired: true });
    const vocabulary = await listVocabulary();
    expect(vocabulary).toHaveLength(26);
    expect(vocabulary.slice(0, 2).map((tag) => tag.slug)).toEqual(["by-the-book", "laid-back"]);
    expect(vocabulary.find((tag) => tag.slug === "quiet")?.status).toBe("retired");
  });
});
