import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { feeds } from "@/db/schema";
import { upsertFeed } from "@/db/upsert-feed";

import { resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => pool.end());

const input = {
  slug: "sd",
  name: "San Diego",
  entityType: "central_office",
  state: "CA",
  url: "https://aasandiego.org/wp-json/tsml/meetings",
} as const;

async function feedRow(slug: string) {
  const [row] = await db.select().from(feeds).where(eq(feeds.slug, slug));
  return row;
}

describe("upsertFeed", () => {
  it.each([
    ["intergroup", 10],
    ["district", 10],
    ["central_office", 10],
    ["area", 20],
  ] as const)("gives a %s feed priority %i by default", async (entityType, priority) => {
    await upsertFeed({ ...input, entityType });
    expect((await feedRow("sd"))?.priority).toBe(priority);
  });

  it("updates an existing feed by slug but never changes its opt-out", async () => {
    const id = await upsertFeed(input);
    await db.update(feeds).set({ optedOut: true }).where(eq(feeds.id, id));
    expect(await upsertFeed({ ...input, name: "AA San Diego", priority: 5 })).toBe(id);
    expect(await feedRow("sd")).toMatchObject({ name: "AA San Diego", priority: 5, optedOut: true });
  });

  it("keeps a feed's validators, schedule and count when neither its URL nor its priority changes", async () => {
    const id = await upsertFeed(input);
    const synced = {
      etag: '"v1"',
      lastModified: "Sat, 26 Sep 2026 10:00:00 GMT",
      lastSuccessAt: new Date("2026-09-26T10:00:00Z"),
      lastAttemptAt: new Date("2026-09-26T10:00:00Z"),
      meetingCount: 40,
    };
    await db.update(feeds).set(synced).where(eq(feeds.id, id));
    await upsertFeed({ ...input, name: "AA San Diego" });
    expect(await feedRow("sd")).toMatchObject(synced);
  });

  it("keeps the shrink guard's count when only the priority changes", async () => {
    const id = await upsertFeed(input);
    await db.update(feeds).set({ etag: '"v1"', meetingCount: 40 }).where(eq(feeds.id, id));
    await upsertFeed({ ...input, priority: 3 });
    expect(await feedRow("sd")).toMatchObject({ etag: null, meetingCount: 40 });
  });

  it.each([{ state: "ca" }, { url: "ftp://x.org/feed" }, { slug: "Has Spaces" }, { priority: 0 }])(
    "rejects %j",
    async (change) => {
      await expect(upsertFeed({ ...input, ...change })).rejects.toThrow();
    },
  );
});
