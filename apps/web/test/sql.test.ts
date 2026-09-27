import { describe, expect, it } from "vitest";

import { sqlStringList } from "@/db/sql";

describe("sqlStringList", () => {
  it("refuses anything that could break out of a string literal", () => {
    expect(() => sqlStringList(["format", "x') or ('1'='1"])).toThrow(/lowercase identifiers/);
  });
});
