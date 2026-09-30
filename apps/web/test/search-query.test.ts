import { describe, expect, it } from "vitest";

import { searchQuery } from "@/app/metrics/search-query";

describe("searchQuery", () => {
  it("trims the search box's value", () => {
    expect(searchQuery("  Nooners ")).toBe("Nooners");
  });

  it("keeps a query of 100 characters", () => {
    expect(searchQuery("a".repeat(100))).toBe("a".repeat(100));
  });

  it.each([undefined, ["Nooners", "Serenity"], "a".repeat(101)])("reads %j as no query", (value) => {
    expect(searchQuery(value)).toBe("");
  });
});
