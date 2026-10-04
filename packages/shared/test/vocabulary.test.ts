import { describe, expect, it } from "vitest";

import {
  isV1TagCategory,
  STARTER_VOCABULARY,
  TAG_CATEGORIES,
  V1_TAG_CATEGORIES,
  V1VocabularyResponse,
  VocabularyResponse,
} from "../src/index";

describe("STARTER_VOCABULARY", () => {
  it("is a valid vocabulary response", () => {
    expect(VocabularyResponse.parse({ tags: STARTER_VOCABULARY }).tags).toEqual(STARTER_VOCABULARY);
  });

  it("has unique slugs", () => {
    const slugs = STARTER_VOCABULARY.map((tag) => tag.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("is grouped in category order", () => {
    const positions = STARTER_VOCABULARY.map((tag) => TAG_CATEGORIES.indexOf(tag.category));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("has a tag in every category", () => {
    expect(new Set(STARTER_VOCABULARY.map((tag) => tag.category))).toEqual(new Set(TAG_CATEGORIES));
  });

  it("lists the meeting sizes smallest first, after the crowd", () => {
    expect(TAG_CATEGORIES.indexOf("size")).toBe(TAG_CATEGORIES.indexOf("crowd") + 1);
    expect(STARTER_VOCABULARY.filter((tag) => tag.category === "size")).toEqual([
      { category: "size", slug: "size-small", label: "Small (under 15)" },
      { category: "size", slug: "size-medium", label: "Medium (15–30)" },
      { category: "size", slug: "size-large", label: "Large (30–100)" },
      { category: "size", slug: "size-very-large", label: "Very large (100+)" },
    ]);
  });

  // Owner decision, 2026-10-03.
  it.each([
    ["format", "check-in", "Check-in"],
    ["sharing", "timed-shares", "Timed shares"],
    ["feel", "good-for-newcomers", "Good for newcomers"],
    ["practical", "kids-welcome", "Kids welcome"],
    ["practical", "snacks", "Snacks"],
  ])("has the %s tag %s", (category, slug, label) => {
    expect(STARTER_VOCABULARY).toContainEqual({ category, slug, label });
  });
});

describe("VocabularyResponse", () => {
  const tag = { slug: "laid-back", label: "Laid back", category: "format" };

  it("accepts a well-formed tag", () => {
    expect(VocabularyResponse.parse({ tags: [tag] })).toEqual({ tags: [tag] });
  });

  it.each(["Laid Back", "laid_back", "-laid-back", "laid--back", ""])("rejects the slug %j", (slug) => {
    expect(VocabularyResponse.safeParse({ tags: [{ ...tag, slug }] }).success).toBe(false);
  });

  // An app reading this list must still work when the server adds a category it has never heard of.
  it("accepts a category this app doesn't know yet", () => {
    const later = { ...tag, category: "meeting-length" };
    expect(VocabularyResponse.parse({ tags: [later] })).toEqual({ tags: [later] });
  });

  it.each(["Vibes", "two words", ""])("rejects the category %j", (category) => {
    expect(VocabularyResponse.safeParse({ tags: [{ ...tag, category }] }).success).toBe(false);
  });

  it.each(["slug", "category"])("rejects a %s longer than 40 characters", (field) => {
    expect(VocabularyResponse.safeParse({ tags: [{ ...tag, [field]: "a".repeat(41) }] }).success).toBe(false);
    expect(VocabularyResponse.safeParse({ tags: [{ ...tag, [field]: "a".repeat(40) }] }).success).toBe(true);
  });

  it("rejects labels longer than 40 characters", () => {
    expect(VocabularyResponse.safeParse({ tags: [{ ...tag, label: "x".repeat(41) }] }).success).toBe(false);
  });
});

// The /api/v1 list, for builds that parse the category with a fixed list and refuse the whole response over any
// other.
describe("V1VocabularyResponse", () => {
  const tag = { slug: "laid-back", label: "Laid back", category: "format" };

  it("accepts the five categories those builds know", () => {
    expect(V1_TAG_CATEGORIES).toEqual(["format", "sharing", "crowd", "feel", "practical"]);
    const tags = V1_TAG_CATEGORIES.map((category) => ({ ...tag, category }));
    expect(V1VocabularyResponse.parse({ tags })).toEqual({ tags });
  });

  it.each(["size", "vibes"])("rejects the category %j", (category) => {
    expect(V1VocabularyResponse.safeParse({ tags: [{ ...tag, category }] }).success).toBe(false);
  });
});

describe("isV1TagCategory", () => {
  it("is true only for the five categories builds before /api/v2 know", () => {
    expect(TAG_CATEGORIES.filter(isV1TagCategory)).toEqual([...V1_TAG_CATEGORIES]);
    expect(isV1TagCategory("vibes")).toBe(false);
  });
});
