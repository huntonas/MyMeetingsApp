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

  it.each([{ state: "ca" }, { url: "ftp://x.org/feed" }, { slug: "Has Spaces" }, { priority: 0 }])(
    "rejects %j",
    async (change) => {
      await expect(upsertFeed({ ...input, ...change })).rejects.toThrow();
    },
  );
});
