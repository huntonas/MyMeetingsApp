import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";

import { pendingSuggestion, suggestionRow } from "./admin-fixtures";
import { resetDb } from "./db";
import { adminGet, formContaining, submitForm } from "./e2e-forms";
import { DEVICE_A_HASH } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

async function reviewPage(): Promise<string> {
  const res = await adminGet("/metrics/suggestions");
  expect(res.status).toBe(200);
  return res.text();
}

describe("suggestion review in the built app", () => {
  it("rejects a suggestion from its form, unlinks the device and says so", async () => {
    const id = await pendingSuggestion("Relaxed");
    const html = await reviewPage();
    expect(html).not.toContain(DEVICE_A_HASH);
    const res = await submitForm("/metrics/suggestions", formContaining(html, "Reject “Relaxed”"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/\/metrics\/suggestions\?notice=rejected$/);
    expect(await suggestionRow(id)).toMatchObject({ status: "rejected", deviceHash: null });
    expect(await (await adminGet("/metrics/suggestions?notice=rejected")).text()).toContain("Rejected.");
  });

  it("adds a suggestion as a new tag with the label and category chosen", async () => {
    const id = await pendingSuggestion("Relaxed");
    const form = { ...formContaining(await reviewPage(), "Add “Relaxed” as a new tag"), label: "Easygoing" };
    const res = await submitForm("/metrics/suggestions", { ...form, category: "feel" });
    expect(res.headers.get("location")).toMatch(/notice=approved$/);
    const [tag] = await db
      .select({ label: tags.label, category: tags.category })
      .from(tags)
      .where(eq(tags.slug, "easygoing"));
    expect(tag).toEqual({ label: "Easygoing", category: "feel" });
    expect(await suggestionRow(id)).toMatchObject({ status: "approved", deviceHash: null });
  });

  it("refuses a label with markup and leaves the suggestion pending", async () => {
    const id = await pendingSuggestion("Relaxed");
    const form = {
      ...formContaining(await reviewPage(), "Add “Relaxed” as a new tag"),
      label: "<b>Loud</b>",
    };
    const res = await submitForm("/metrics/suggestions", form);
    expect(res.headers.get("location")).toMatch(/notice=invalid_form$/);
    expect(await suggestionRow(id)).toMatchObject({ status: "pending", deviceHash: DEVICE_A_HASH });
  });

  it("refuses the same form posted from another site (spec §14)", async () => {
    const id = await pendingSuggestion("Relaxed");
    const form = formContaining(await reviewPage(), "Reject “Relaxed”");
    const res = await submitForm("/metrics/suggestions", form, "https://evil.example");
    expect(res.status).toBe(403);
    expect(await suggestionRow(id)).toMatchObject({ status: "pending", deviceHash: DEVICE_A_HASH });
  });
});
