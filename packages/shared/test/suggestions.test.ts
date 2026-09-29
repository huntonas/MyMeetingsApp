import { describe, expect, it } from "vitest";

import { SuggestionRequest } from "../src/index";

describe("SuggestionRequest", () => {
  it("accepts and trims a short description", () => {
    expect(SuggestionRequest.parse({ text: "  Big print books " })).toEqual({ text: "Big print books" });
    expect(SuggestionRequest.parse({ text: "Café after" })).toEqual({ text: "Café after" });
  });

  it.each(["a", "x".repeat(41), "http://example.org", "<b>loud</b>", "   "])("rejects %j", (text) => {
    expect(SuggestionRequest.safeParse({ text }).success).toBe(false);
  });
});
