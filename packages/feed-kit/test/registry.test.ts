import { describe, expect, it } from "vitest";

import { parseRegistry, RegistryEntry } from "../src/index";

const entry = {
  id: "some-county-intergroup-tn",
  name: "Some County Intergroup",
  entity_type: "intergroup",
  state: "TN",
  website: "https://example.org",
  feed_type: "tsml",
  feed_url: "https://example.org/wp-json/tsml/meetings",
  verified: true,
  meeting_count: 612,
  states_covered: ["TN"],
  checked_at: "2026-09-25",
  notes: "",
};

describe("RegistryEntry", () => {
  it("accepts the spec's example entry", () => {
    expect(RegistryEntry.parse(entry)).toEqual(entry);
  });

  it("keeps a manual opt-out", () => {
    expect(RegistryEntry.parse({ ...entry, opted_out: true }).opted_out).toBe(true);
  });

  it.each([
    { feed_type: "rss" },
    { entity_type: "club" },
    { state: "Tennessee" },
    { checked_at: "Sept 25" },
    { feed_url: "javascript:alert(1)" },
    { website: "example.org" },
  ])("rejects %j", (change) => {
    expect(RegistryEntry.safeParse({ ...entry, ...change }).success).toBe(false);
  });

  it("allows entities with no website or feed", () => {
    expect(
      RegistryEntry.parse({
        ...entry,
        website: null,
        feed_type: "none_found",
        feed_url: null,
        verified: false,
        meeting_count: 0,
        states_covered: [],
      }),
    ).toMatchObject({ website: null, feed_url: null });
  });
});

describe("parseRegistry", () => {
  const yamlEntry = `- id: some-county-intergroup-tn
  name: Some County Intergroup
  entity_type: intergroup
  state: TN
  website: https://example.org
  feed_type: tsml
  feed_url: https://example.org/wp-json/tsml/meetings
  verified: true
  meeting_count: 612
  states_covered: [TN]
  checked_at: "2026-09-25"
  notes: ""
`;

  it("reads a YAML list of entries", () => {
    expect(parseRegistry(yamlEntry)).toEqual([entry]);
  });

  it.each(["", "id: not-a-list\n", "just text\n"])("throws when the document isn't a list: %j", (raw) => {
    expect(() => parseRegistry(raw)).toThrow("registry must be a YAML list");
  });

  it("throws naming the id of an invalid entry", () => {
    expect(() => parseRegistry(yamlEntry.replace("meeting_count: 612", "meeting_count: -1"))).toThrow(
      /some-county-intergroup-tn/,
    );
  });

  it("throws naming the index of an invalid entry that has no id", () => {
    expect(() => parseRegistry(`${yamlEntry}- name: No Id\n`)).toThrow(/entry 1/);
  });
});
