import { readFileSync } from "node:fs";
import path from "node:path";

import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import PrivacyPage from "@/app/(site)/privacy/page";
import { DATA_INVENTORY, ON_PHONE, THIRD_PARTIES } from "@/content/privacy-inventory";
import * as schema from "@/db/schema";

import { renderText } from "./render";

// Spec §14: "Every privacy policy statement maps to a row in section 13 and to behavior in code." These tests
// fail when SPEC.md, the database schema or the policy changes without the others.
const SPEC = readFileSync(path.resolve(import.meta.dirname, "../../../SPEC.md"), "utf8");

// Public meeting data, about no one. The policy describes it in prose ("Meeting listings"), not in the inventory.
const REFERENCE_TABLES = ["address_geocodes", "feed_meetings", "feeds", "meetings", "tags"];

function section(heading: string): string {
  const start = SPEC.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`SPEC.md has no "## ${heading}"`);
  const end = SPEC.indexOf("\n## ", start + 1);
  return SPEC.slice(start, end < 0 ? undefined : end);
}

// The data rows of the nth markdown table in a section, without its header and separator, as trimmed cells with
// backticks removed.
function tableRows(text: string, n: number): string[][] {
  const table = text.split(/\n\s*\n/).filter((block) => block.trimStart().startsWith("|"))[n];
  if (table === undefined) throw new Error(`no table ${String(n)}`);
  return table
    .trim()
    .split("\n")
    .slice(2)
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.replaceAll("`", "").trim()),
    );
}

const inventory = section("13. Data inventory (source of truth for the privacy policy)");
const storedRows = tableRows(inventory, 0);

describe("the privacy policy matches SPEC.md §13", () => {
  it("has one entry for each row of the stored-data table", () => {
    expect(DATA_INVENTORY.map((entry) => entry.specRow).sort()).toEqual(
      storedRows.map(([name]) => name ?? "").sort(),
    );
  });

  it("states every retention period the table gives", () => {
    for (const [name, , , retention] of storedRows) {
      const entry = DATA_INVENTORY.find((candidate) => candidate.specRow === name);
      const numbers = (retention ?? "").replace(/§\d+/g, "").match(/\d+/g) ?? [];
      for (const number of numbers) {
        expect(entry?.kept, `${String(name)} keeps ${number}`).toMatch(new RegExp(`\\b${number}\\b`));
      }
    }
  });

  it("names a real table for every stored row, and covers every table in the schema", () => {
    const schemaTables = Object.values(schema)
      .filter((value) => is(value, PgTable))
      .map((table) => getTableName(table))
      .sort();
    const inventoryTables = DATA_INVENTORY.flatMap((entry) => (entry.table === null ? [] : [entry.table]));
    expect([...inventoryTables, ...REFERENCE_TABLES].sort()).toEqual(schemaTables);
    for (const entry of DATA_INVENTORY) {
      if (entry.table !== null) expect(entry.table).toBe(entry.specRow);
    }
  });

  it("keeps on the phone exactly what the table says stays there", () => {
    const cell = tableRows(inventory, 1)[0]?.[0] ?? "";
    expect(ON_PHONE.map((item) => item.specItem).sort()).toEqual(
      cell
        .split(",")
        .map((item) => item.trim())
        .sort(),
    );
  });
});

describe("the privacy policy matches SPEC.md §2", () => {
  it("lists every third party that receives data", () => {
    const bullet =
      section("2. Privacy rules")
        .split("\n")
        .find((line) => line.includes("**Third parties that receive data**")) ?? "";
    const named = bullet
      .slice(bullet.indexOf("privacy policy:") + "privacy policy:".length)
      .replace(/\([^)]*\)/g, "")
      .replace(/\s*\.\s*$/, "")
      .split(",")
      .map((part) => part.trim().replace(/^and /, ""))
      .flatMap((part) => part.split(" and "))
      .map((part) => part.trim());
    expect(THIRD_PARTIES.map((party) => party.specName).sort()).toEqual(named.sort());
  });

  it("says suggestion screening keeps nothing", () => {
    const screening = THIRD_PARTIES.find(
      (party) => party.specName === "the AI provider used for suggestion screening",
    );
    expect(screening?.role).toContain("zero data retention");
  });
});

describe("the privacy policy page", () => {
  const text = renderText(<PrivacyPage />);

  it("is marked as a draft pending legal review", () => {
    expect(text).toContain("Draft, pending legal review.");
  });

  it("shows every inventory entry, everything that stays on the phone and every third party", () => {
    for (const entry of DATA_INVENTORY) {
      for (const words of [entry.title, entry.what, entry.linkedTo, entry.kept])
        expect(text).toContain(words);
    }
    for (const item of ON_PHONE) expect(text).toContain(item.text);
    for (const party of THIRD_PARTIES) {
      expect(text).toContain(party.name);
      expect(text).toContain(party.role);
    }
  });

  it("says deleted data can outlive deletion in the database's restore history (spec §9)", () => {
    expect(text).toContain("restore history for up to 30 days");
  });
});
