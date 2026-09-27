import { STARTER_VOCABULARY } from "@mymeetingapp/shared";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";

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

  it("returns how many tags it seeded", async () => {
    expect(await seedVocabulary()).toBe(STARTER_VOCABULARY.length);
  });

  it("can run again without duplicating tags", async () => {
    await seedVocabulary();
    await seedVocabulary();
    expect(await tagRows()).toHaveLength(STARTER_VOCABULARY.length);
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
