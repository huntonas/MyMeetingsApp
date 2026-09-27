import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { sqlArray, sqlStringList } from "@/db/sql";

afterAll(() => pool.end());

describe("sqlStringList", () => {
  it("refuses anything that could break out of a string literal", () => {
    expect(() => sqlStringList(["format", "x') or ('1'='1"])).toThrow(/lowercase identifiers/);
  });
});

describe("sqlArray", () => {
  it("binds a text array a value can be matched against with ANY", async () => {
    const result = await db.execute<{ matches: boolean }>(
      sql`select ${"b"} = any(${sqlArray(["a", "b", "c"], "text")}) as matches`,
    );
    expect(result.rows[0]?.matches).toBe(true);
  });

  it("binds an empty array as an empty Postgres array, not a syntax error", async () => {
    const result = await db.execute<{ matches: boolean }>(
      sql`select ${"b"} = any(${sqlArray([], "text")}) as matches`,
    );
    expect(result.rows[0]?.matches).toBe(false);
  });

  it("binds a uuid array", async () => {
    const id = "00000000-0000-0000-0000-000000000001";
    const result = await db.execute<{ matches: boolean }>(
      sql`select ${id}::uuid = any(${sqlArray([id], "uuid")}) as matches`,
    );
    expect(result.rows[0]?.matches).toBe(true);
  });
});
