import { VocabularyResponse } from "@mymeetingapp/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/v1/vocabulary/route";
import { db, pool } from "@/db/client";
import { tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";

import { resetDb } from "./db";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

async function getVocabulary() {
  const res = await GET(new Request("http://test/api/v1/vocabulary"));
  return { res, body: VocabularyResponse.parse(await res.json()) };
}

describe("GET /api/v1/vocabulary", () => {
  it("returns the active tags with a one-hour shared cache", async () => {
    const { res, body } = await getVocabulary();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=3600, stale-while-revalidate=86400");
    expect(body.tags.slice(0, 2)).toEqual([
      { slug: "by-the-book", label: "By the book", category: "format" },
      { slug: "laid-back", label: "Laid back", category: "format" },
    ]);
  });

  it("leaves out retired tags", async () => {
    await db.update(tags).set({ status: "retired" }).where(eq(tags.slug, "coffee"));
    const { body } = await getVocabulary();
    expect(body.tags.map((tag) => tag.slug)).not.toContain("coffee");
    expect(body.tags.map((tag) => tag.slug)).toContain("runs-long");
  });

  it("groups by category order, then sort order, whatever the insert order", async () => {
    await db.insert(tags).values({ slug: "big-book", label: "Big Book", category: "format", sortOrder: 100 });
    await db.insert(tags).values({ slug: "a-first", label: "A first", category: "practical", sortOrder: -1 });
    const { body } = await getVocabulary();
    const slugs = body.tags.map((tag) => tag.slug);
    expect(slugs.indexOf("big-book")).toBe(slugs.indexOf("crosstalk") - 1);
    expect(slugs.indexOf("a-first")).toBe(slugs.indexOf("starts-on-time") - 1);
  });
});
