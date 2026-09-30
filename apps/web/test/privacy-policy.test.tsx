import { readFileSync } from "node:fs";
import path from "node:path";

import { getTableName, is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import PrivacyPage from "@/app/(site)/privacy/page";
import {
  DATA_INVENTORY,
  ON_PHONE,
  PHONE_BACKUP,
  SUPPORT_EMAIL,
  THIRD_PARTIES,
} from "@/content/privacy-inventory";
import * as schema from "@/db/schema";

import { renderText } from "./render";

// Spec §14: "Every privacy policy statement maps to a row in section 13 and to behavior in code." These tests
// fail when SPEC.md, the database schema or the policy changes without the others.
const SPEC = readFileSync(path.resolve(import.meta.dirname, "../../../SPEC.md"), "utf8");

// Public meeting data, about no one. The policy describes it in prose ("Meeting listings"), not in the inventory, so
// its columns are pinned here: a new one (a contact email, say) fails until the policy has been reviewed.
const REFERENCE_TABLES: Record<string, string[]> = {
  address_geocodes: ["address_key", "status", "latitude", "longitude", "attempted_at"],
  feed_meetings: [
    "id",
    "feed_id",
    "meeting_id",
    "source_slug",
    "day",
    "time",
    "end_time",
    "timezone",
    "name",
    "types",
    "attendance",
    "location_name",
    "formatted_address",
    "address_key",
    "latitude",
    "longitude",
    "location_notes",
    "notes",
    "group_name",
    "conference_url",
    "conference_key",
    "conference_url_notes",
    "conference_phone",
    "conference_phone_notes",
    "source_url",
    "seen_at",
    "archived_at",
  ],
  feeds: [
    "id",
    "slug",
    "name",
    "entity_type",
    "state",
    "url",
    "priority",
    "opted_out",
    "etag",
    "last_modified",
    "last_attempt_at",
    "last_success_at",
    "last_error",
    "meeting_count",
    "created_at",
  ],
  meetings: [
    "id",
    "primary_feed_meeting_id",
    "day",
    "time",
    "latitude",
    "longitude",
    "timezone",
    "tags_disabled",
    "archived_at",
    "created_at",
    "updated_at",
  ],
  tags: ["id", "slug", "label", "category", "sort_order", "status", "created_at"],
};

const SCHEMA_TABLES = Object.values(schema).filter((value) => is(value, PgTable));

// Every column of a table in the schema, by its database name.
function schemaColumns(name: string): string[] {
  const table = SCHEMA_TABLES.find((candidate) => getTableName(candidate) === name);
  if (table === undefined) throw new Error(`no table ${name} in the schema`);
  return getTableConfig(table)
    .columns.map((column) => column.name)
    .sort();
}

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
// Every row of §13's stored-data table: what our server and hosts keep, and the support mailbox.
const ALL_ENTRIES = [...DATA_INVENTORY, SUPPORT_EMAIL];

describe("the privacy policy matches SPEC.md §13", () => {
  it("has one entry for each row of the stored-data table", () => {
    expect(ALL_ENTRIES.map((entry) => entry.specRow).sort()).toEqual(
      storedRows.map(([name]) => name ?? "").sort(),
    );
  });

  it("states every retention period the table gives", () => {
    for (const [name, , , retention] of storedRows) {
      const entry = ALL_ENTRIES.find((candidate) => candidate.specRow === name);
      const numbers = (retention ?? "").replace(/§\d+/g, "").match(/\d+/g) ?? [];
      for (const number of numbers) {
        expect(entry?.kept, `${String(name)} keeps ${number}`).toMatch(new RegExp(`\\b${number}\\b`));
      }
    }
  });

  it("repeats each row's cells, so any edit to the table forces a review of the policy", () => {
    for (const [name, contents, linkedTo, retention] of storedRows) {
      const entry = ALL_ENTRIES.find((candidate) => candidate.specRow === name);
      expect(entry?.specCells, String(name)).toEqual({ contents, linkedTo, retention });
    }
  });

  it("names a real table for every stored row, and covers every table in the schema", () => {
    const schemaTables = SCHEMA_TABLES.map((table) => getTableName(table)).sort();
    const inventoryTables = DATA_INVENTORY.flatMap((entry) =>
      entry.table === null ? [] : [entry.table.name],
    );
    expect([...inventoryTables, ...Object.keys(REFERENCE_TABLES)].sort()).toEqual(schemaTables);
    for (const entry of DATA_INVENTORY) {
      if (entry.table !== null) expect(entry.table.name).toBe(entry.specRow);
    }
  });

  it("lists every column of every table, so a new column forces a review of the policy", () => {
    for (const entry of DATA_INVENTORY) {
      if (entry.table !== null) {
        expect([...entry.table.columns].sort(), entry.table.name).toEqual(schemaColumns(entry.table.name));
      }
    }
    for (const [name, columns] of Object.entries(REFERENCE_TABLES)) {
      expect([...columns].sort(), name).toEqual(schemaColumns(name));
    }
  });

  it("says the phone's own backups, wherever they go, may include what stays on the phone", () => {
    expect(PHONE_BACKUP.specSentence).toBe(
      "The phone's own backups (to iCloud, Google, the phone maker's cloud or a computer) may include this data, as they can for most apps. Those backups are the person's, and they never reach our server.",
    );
    expect(inventory).toContain(PHONE_BACKUP.specSentence);
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
    for (const entry of ALL_ENTRIES) {
      for (const words of [entry.title, entry.what, entry.linkedTo, entry.kept])
        expect(text).toContain(words);
    }
    for (const item of ON_PHONE) expect(text).toContain(item.text);
    for (const party of THIRD_PARTIES) {
      expect(text).toContain(party.name);
      expect(text).toContain(party.role);
    }
  });

  it("says, right after what stays on the phone, that the phone's own backups may include it", () => {
    expect(PHONE_BACKUP.text).toBe(
      "Your phone's own backups (to iCloud, Google, your phone maker's cloud or a computer) may include them, as they can for most apps. Those backups are yours, and they never reach our server.",
    );
    const backup = text.indexOf(PHONE_BACKUP.text);
    expect(backup).toBeGreaterThan(text.indexOf("What stays on your phone"));
    expect(backup).toBeGreaterThan(text.indexOf(ON_PHONE.at(-1)?.text ?? "missing"));
    expect(backup).toBeLessThan(text.indexOf("What our server stores"));
  });

  it("says who carries support email, how long we keep it, and that it's never linked to tags", () => {
    expect(text).toContain("When you email us");
    expect(text).toContain("goes through Google Workspace");
    expect(text).toContain("only to answer you and act on it");
    expect(text).toContain("delete it within 90 days after it's resolved");
    expect(text).toContain(
      "Deleted mail can remain in Google's trash and recovery for up to about 55 days after that.",
    );
    expect(text).toContain("never link it to anyone's tags");
  });

  it("says deleted data can outlive deletion in the database's restore history (spec §9)", () => {
    expect(text).toContain("restore history for up to 30 days");
  });
});
