import { STARTER_VOCABULARY } from "@mymeetingapp/shared";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { getActiveVocabulary } from "@/server/vocabulary";

import { resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => pool.end());

async function tagRows() {
  return db
    .select({ slug: tags.slug, label: tags.label, category: tags.category, status: tags.status })
    .from(tags)
    .orderBy(asc(tags.sortOrder));
}

describe("seedVocabulary", () => {
  it("inserts every starter tag as active, in display order", async () => {
    await seedVocabulary();
    expect(await tagRows()).toEqual(STARTER_VOCABULARY.map((tag) => ({ ...tag, status: "active" })));
  });

  it("seeds the size category and the tags added on 2026-10-03", async () => {
    await seedVocabulary();
    const slugs = (await tagRows()).map((row) => row.slug);
    expect(slugs).toEqual(
      expect.arrayContaining(["size-small", "size-very-large", "check-in", "kids-welcome"]),
    );
  });

  it("returns how many tags it seeded", async () => {
    expect(await seedVocabulary()).toBe(STARTER_VOCABULARY.length);
  });

  it("can run again without duplicating tags", async () => {
    await seedVocabulary();
    await seedVocabulary();
    expect(await tagRows()).toHaveLength(STARTER_VOCABULARY.length);
  });

  // An approved suggestion is appended at max(sort_order) + 1 (approveSuggestion). A reseed with more tags renumbers
  // the seeded ones, so without care it would move an approved tag ahead of seeded tags in its category.
  it("keeps tags it didn't seed after the seeded ones, in their own order", async () => {
    await db.insert(tags).values([
      { slug: "big-print", label: "Big print", category: "practical", sortOrder: 26 },
      { slug: "alarm-clock", label: "Alarm clock", category: "practical", sortOrder: 27 },
      { slug: "candlelight", label: "Candlelight", category: "feel", sortOrder: 28 },
    ]);
    await seedVocabulary();
    const vocabulary = await getActiveVocabulary();
    const inCategory = (category: string) =>
      vocabulary.filter((tag) => tag.category === category).map((tag) => tag.slug);
    expect(inCategory("practical").slice(-3)).toEqual(["kids-welcome", "big-print", "alarm-clock"]);
    expect(inCategory("feel").slice(-2)).toEqual(["serious-tone", "candlelight"]);
    await seedVocabulary();
    expect(await getActiveVocabulary()).toEqual(vocabulary);
  });

  it("leaves a retired tag retired", async () => {
    await seedVocabulary();
    await db.update(tags).set({ status: "retired" }).where(eq(tags.slug, "runs-long"));
    await seedVocabulary();
    const [row] = await db.select({ status: tags.status }).from(tags).where(eq(tags.slug, "runs-long"));
    expect(row?.status).toBe("retired");
  });

  it("restores a label that was changed in the database", async () => {
    await seedVocabulary();
    await db.update(tags).set({ label: "Long-timers" }).where(eq(tags.slug, "old-timers"));
    await seedVocabulary();
    const [row] = await db.select({ label: tags.label }).from(tags).where(eq(tags.slug, "old-timers"));
    expect(row?.label).toBe("Old-timers");
  });
});

describe("tags table", () => {
  const valid = { slug: "big-book", label: "Big Book", category: "format", sortOrder: 99 } as const;

  it("rejects an unknown category", async () => {
    // @ts-expect-error -- deliberately invalid category, to exercise the database constraint
    const insert = db.insert(tags).values({ ...valid, category: "vibes" });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "tags_category_check" } });
  });

  it("rejects an unknown status", async () => {
    // @ts-expect-error -- deliberately invalid status, to exercise the database constraint
    const insert = db.insert(tags).values({ ...valid, status: "deleted" });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "tags_status_check" } });
  });

  it("rejects a duplicate slug", async () => {
    await db.insert(tags).values(valid);
    const insert = db.insert(tags).values({ ...valid, label: "Other" });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "tags_slug_unique" } });
  });
});
