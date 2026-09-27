import { describe, expect, it } from "vitest";

import { STARTER_VOCABULARY, TAG_CATEGORIES, VocabularyResponse } from "../src/index";

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
});

describe("VocabularyResponse", () => {
  const tag = { slug: "laid-back", label: "Laid back", category: "format" };

  it("accepts a well-formed tag", () => {
    expect(VocabularyResponse.parse({ tags: [tag] })).toEqual({ tags: [tag] });
  });

  it.each(["Laid Back", "laid_back", "-laid-back", "laid--back", ""])("rejects the slug %j", (slug) => {
    expect(VocabularyResponse.safeParse({ tags: [{ ...tag, slug }] }).success).toBe(false);
  });

  it("rejects an unknown category", () => {
    expect(VocabularyResponse.safeParse({ tags: [{ ...tag, category: "vibes" }] }).success).toBe(false);
  });

  it("rejects labels longer than 40 characters", () => {
    expect(VocabularyResponse.safeParse({ tags: [{ ...tag, label: "x".repeat(41) }] }).success).toBe(false);
  });
});
