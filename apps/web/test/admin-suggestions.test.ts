import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { aiDecisions, suggestions, tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import {
  ApproveSuggestionForm,
  approveSuggestion,
  listPendingSuggestions,
  listRecentAiDecisions,
  mergeSuggestion,
  rejectSuggestion,
} from "@/server/admin/suggestions";

import { resetDb } from "./db";
import { DEVICE_A_HASH } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

async function pendingSuggestion(text: string): Promise<number> {
  const [row] = await db
    .insert(suggestions)
    .values({ text, deviceHash: DEVICE_A_HASH })
    .returning({ id: suggestions.id });
  if (row === undefined) throw new Error("the suggestion was not saved");
  return row.id;
}

async function suggestionRow(id: number) {
  const [row] = await db
    .select({
      status: suggestions.status,
      mergedTagId: suggestions.mergedTagId,
      deviceHash: suggestions.deviceHash,
      reviewedAt: suggestions.reviewedAt,
    })
    .from(suggestions)
    .where(eq(suggestions.id, id));
  return row;
}

async function tagBySlug(slug: string) {
  const [row] = await db.select().from(tags).where(eq(tags.slug, slug));
  return row;
}

describe("listPendingSuggestions", () => {
  it("lists pending suggestions oldest first with their AI decisions, and never the device", async () => {
    const newer = await pendingSuggestion("Relaxed");
    const older = await pendingSuggestion("Big print books");
    await db
      .update(suggestions)
      .set({ createdAt: new Date("2026-09-01T00:00:00Z") })
      .where(eq(suggestions.id, older));
    await db.insert(aiDecisions).values({
      suggestionId: newer,
      input: "Relaxed",
      decision: "pending",
      tagSlug: null,
      reason: "Unsure.",
      model: "openai/gpt-5-nano",
    });
    await rejectSuggestion({ suggestionId: await pendingSuggestion("Loud") });

    const pending = await listPendingSuggestions();
    expect(
      pending.map((row) => [row.id, row.text, row.decisions.map((ai) => [ai.decision, ai.reason])]),
    ).toEqual([
      [older, "Big print books", []],
      [newer, "Relaxed", [["pending", "Unsure."]]],
    ]);
    expect(JSON.stringify(pending)).not.toContain(DEVICE_A_HASH);
  });
});

describe("listRecentAiDecisions", () => {
  it("lists the latest decisions with what became of each suggestion", async () => {
    const id = await pendingSuggestion("Relaxed");
    await db.insert(aiDecisions).values({
      suggestionId: id,
      input: "Relaxed",
      decision: "merge",
      tagSlug: "laid-back",
      reason: "A synonym.",
      model: "openai/gpt-5-nano",
    });
    await rejectSuggestion({ suggestionId: id });
    expect(
      (await listRecentAiDecisions()).map((ai) => [ai.input, ai.decision, ai.tagSlug, ai.status]),
    ).toEqual([["Relaxed", "merge", "laid-back", "rejected"]]);
  });
});

describe("approveSuggestion (spec §5)", () => {
  it("adds an active tag from the label, last in the vocabulary order, and unlinks the device", async () => {
    const id = await pendingSuggestion("Big print books");
    expect(
      await approveSuggestion({ suggestionId: id, label: "Large print books", category: "practical" }),
    ).toBe("approved");
    const tag = await tagBySlug("large-print-books");
    expect(tag).toMatchObject({
      label: "Large print books",
      category: "practical",
      status: "active",
      sortOrder: 26,
    });
    const row = await suggestionRow(id);
    expect(row).toMatchObject({ status: "approved", mergedTagId: tag?.id, deviceHash: null });
    expect(row?.reviewedAt).toBeInstanceOf(Date);
  });

  it("folds accents and '&' into the tag's id", async () => {
    const id = await pendingSuggestion("Café & chat");
    await approveSuggestion({ suggestionId: id, label: "Café & chat", category: "feel" });
    expect(await tagBySlug("cafe-and-chat")).toMatchObject({ label: "Café & chat" });
  });

  it("refuses a label that makes an existing tag's slug, leaving the suggestion pending", async () => {
    const id = await pendingSuggestion("Laid-back");
    expect(await approveSuggestion({ suggestionId: id, label: "Laid-back", category: "format" })).toBe(
      "tag_exists",
    );
    expect(await suggestionRow(id)).toMatchObject({ status: "pending", deviceHash: DEVICE_A_HASH });
  });

  it("refuses a label with no letters a–z", async () => {
    const id = await pendingSuggestion("静か");
    expect(await approveSuggestion({ suggestionId: id, label: "静か", category: "feel" })).toBe(
      "label_invalid",
    );
    expect(await suggestionRow(id)).toMatchObject({ status: "pending" });
  });

  it("a second review of the same suggestion changes nothing", async () => {
    const id = await pendingSuggestion("Big print books");
    await approveSuggestion({ suggestionId: id, label: "Large print books", category: "practical" });
    expect(await approveSuggestion({ suggestionId: id, label: "Big print", category: "practical" })).toBe(
      "already_reviewed",
    );
    expect(await rejectSuggestion({ suggestionId: id })).toBe("already_reviewed");
    expect(await tagBySlug("big-print")).toBeUndefined();
    expect(await suggestionRow(id)).toMatchObject({ status: "approved" });
  });

  it("won't store an approved suggestion without its tag", async () => {
    const id = await pendingSuggestion("Relaxed");
    await expect(
      db.update(suggestions).set({ status: "approved" }).where(eq(suggestions.id, id)),
    ).rejects.toMatchObject({ cause: { constraint: "suggestions_merged_tag_check" } });
  });
});

describe("mergeSuggestion", () => {
  it("merges into an active tag and unlinks the device", async () => {
    const id = await pendingSuggestion("Chill");
    expect(await mergeSuggestion({ suggestionId: id, tagSlug: "laid-back" })).toBe("merged");
    expect(await suggestionRow(id)).toMatchObject({
      status: "merged",
      mergedTagId: (await tagBySlug("laid-back"))?.id,
      deviceHash: null,
    });
  });

  it("refuses a retired tag", async () => {
    await db.update(tags).set({ status: "retired" }).where(eq(tags.slug, "laid-back"));
    const id = await pendingSuggestion("Chill");
    expect(await mergeSuggestion({ suggestionId: id, tagSlug: "laid-back" })).toBe("tag_not_found");
    expect(await suggestionRow(id)).toMatchObject({ status: "pending" });
  });
});

describe("rejectSuggestion", () => {
  it("rejects and unlinks the device", async () => {
    const id = await pendingSuggestion("Loud");
    expect(await rejectSuggestion({ suggestionId: id })).toBe("rejected");
    expect(await suggestionRow(id)).toMatchObject({
      status: "rejected",
      mergedTagId: null,
      deviceHash: null,
    });
  });
});

describe("ApproveSuggestionForm", () => {
  it("reads a submitted form: the id as a number and the label trimmed", () => {
    expect(
      ApproveSuggestionForm.parse({
        suggestionId: "3",
        label: "  Large print books ",
        category: "practical",
      }),
    ).toEqual({ suggestionId: 3, label: "Large print books", category: "practical" });
  });

  it.each([
    { suggestionId: "3", label: "<b>Loud</b>", category: "feel" },
    { suggestionId: "x", label: "Relaxed", category: "feel" },
    { suggestionId: "3", label: "Relaxed", category: "vibes" },
  ])("refuses %j", (form) => {
    expect(ApproveSuggestionForm.safeParse(form).success).toBe(false);
  });
});
