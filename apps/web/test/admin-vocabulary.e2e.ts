import { V1VocabularyResponse, VocabularyResponse } from "@mymeetingapp/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";

import { resetDb } from "./db";
import { adminGet, formContaining, submitForm } from "./e2e-forms";
import { E2E_URL } from "./e2e-server";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

describe("the vocabulary in the built app", () => {
  it("retires a tag from its form", async () => {
    const html = await (await adminGet("/metrics/vocabulary")).text();
    const res = await submitForm("/metrics/vocabulary", formContaining(html, "Retire “Quiet”"));
    expect(res.headers.get("location")).toMatch(/\/metrics\/vocabulary\?notice=tag_retired$/);
    const [row] = await db.select({ status: tags.status }).from(tags).where(eq(tags.slug, "quiet"));
    expect(row).toEqual({ status: "retired" });
  });

  it("serves the size tags in the /api/v2 list only", async () => {
    const v2 = VocabularyResponse.parse(await (await fetch(`${E2E_URL}/api/v2/vocabulary`)).json());
    const v1 = V1VocabularyResponse.parse(await (await fetch(`${E2E_URL}/api/v1/vocabulary`)).json());
    expect(v2.tags).toContainEqual({ slug: "size-small", label: "Small (under 15)", category: "size" });
    expect(v1.tags.map((tag) => tag.slug)).toEqual(
      v2.tags.filter((tag) => tag.category !== "size").map((tag) => tag.slug),
    );
  });
});
