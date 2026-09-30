import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";

import { resetDb } from "./db";
import { adminGet, formContaining, submitForm } from "./e2e-forms";

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
});
