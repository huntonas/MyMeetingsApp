import type { RegistryEntry } from "@mymeetingapp/feed-kit";
import { describe, expect, it } from "vitest";

import type { DirectoryEntity } from "../src/directory";
import type { VerifyResult } from "../src/verify";
import { buildRegistry, computeChanges, computeOverlaps, renderCoverage } from "../src/report";

const someCountyEntity: DirectoryEntity = {
  id: "some-county-intergroup",
  name: "Some County Intergroup",
  entityType: "intergroup",
  state: "TN",
  website: "https://example.org",
  notes: "",
};

const someCountyVerification: VerifyResult = {
  verified: true,
  meetingCount: 612,
  statesCovered: ["TN"],
  citiesCovered: ["Nashville, TN"],
  meetingKeys: new Set(),
};

const otherIntergroupEntity: DirectoryEntity = {
  id: "other-intergroup",
  name: "Other Intergroup",
  entityType: "intergroup",
  state: "TN",
  website: "https://other.example.org",
  notes: "",
};

describe("buildRegistry", () => {
  it("produces the spec example entry from a found TSML detection with verification", () => {
    const [entry] = buildRegistry(
      [
        {
          entity: someCountyEntity,
          detection: {
            feedType: "tsml",
            feedUrl: "https://example.org/wp-admin/admin-ajax.php?action=meetings",
            body: [],
            notes: "",
          },
          verification: someCountyVerification,
        },
      ],
      [],
      "2026-09-25",
    );

    expect(entry).toEqual({
      id: "some-county-intergroup",
      name: "Some County Intergroup",
      entity_type: "intergroup",
      state: "TN",
      website: "https://example.org",
      feed_type: "tsml",
      feed_url: "https://example.org/wp-admin/admin-ajax.php?action=meetings",
      verified: true,
      meeting_count: 612,
      states_covered: ["TN"],
      cities_covered: ["Nashville, TN"],
      checked_at: "2026-09-25",
      notes: "",
    });
  });

  it("turns a restricted detection into an unverified entry with a zero count", () => {
    const [entry] = buildRegistry(
      [
        {
          entity: otherIntergroupEntity,
          detection: {
            feedType: "restricted",
            feedUrl: "https://other.example.org/wp-json/tsml/meetings",
            notes: "TSML feed restricted; contact the intergroup",
          },
          verification: null,
        },
      ],
      [],
      "2026-09-25",
    );

    expect(entry).toMatchObject({
      verified: false,
      meeting_count: 0,
      notes: "TSML feed restricted; contact the intergroup",
    });
  });

  it("never writes a feed_url that carries a sharing key", () => {
    const [entry] = buildRegistry(
      [
        {
          entity: otherIntergroupEntity,
          detection: {
            feedType: "restricted",
            feedUrl: "https://other.example.org/feed?key=secret",
            notes: "TSML feed restricted; contact the intergroup",
          },
          verification: null,
        },
      ],
      [],
      "2026-09-25",
    );

    expect(entry?.feed_url).toBeNull();
  });

  it("keeps opted_out: true carried over from the previous entry", () => {
    const previous: RegistryEntry[] = [
      {
        id: "some-county-intergroup",
        name: "Some County Intergroup",
        entity_type: "intergroup",
        state: "TN",
        website: "https://example.org",
        feed_type: "tsml",
        feed_url: "https://example.org/wp-admin/admin-ajax.php?action=meetings",
        verified: true,
        meeting_count: 612,
        states_covered: ["TN"],
        cities_covered: [],
        checked_at: "2026-08-25",
        notes: "",
        opted_out: true,
      },
    ];

    const [entry] = buildRegistry(
      [
        {
          entity: someCountyEntity,
          detection: {
            feedType: "tsml",
            feedUrl: "https://example.org/wp-admin/admin-ajax.php?action=meetings",
            body: [],
            notes: "",
          },
          verification: someCountyVerification,
        },
      ],
      previous,
      "2026-09-25",
    );

    expect(entry?.opted_out).toBe(true);
  });

  it("carries forward an opted-out entry the directory no longer lists, but drops other missing entries", () => {
    const optedOut = registryEntry({ id: "opted-out-office", checked_at: "2026-08-25", opted_out: true });
    const gone = registryEntry({ id: "gone-office", checked_at: "2026-08-25" });

    expect(buildRegistry([], [optedOut, gone], "2026-09-25")).toEqual([
      {
        id: "opted-out-office",
        name: "Entity",
        entity_type: "intergroup",
        state: "TN",
        website: null,
        feed_type: "tsml",
        feed_url: null,
        verified: true,
        meeting_count: 100,
        states_covered: [],
        cities_covered: [],
        checked_at: "2026-08-25",
        notes: "",
        opted_out: true,
      },
    ]);
  });
});

describe("computeOverlaps", () => {
  it("pairs feeds sharing at least one meeting key, sorted by shared count", () => {
    const keysByFeed = new Map([
      ["x", new Set(["a|1", "b|2"])],
      ["y", new Set(["a|1", "b|2", "c|3"])],
    ]);
    expect(computeOverlaps(keysByFeed)).toEqual([{ a: "x", b: "y", shared: 2 }]);
  });

  it("finds nothing for disjoint feeds", () => {
    const keysByFeed = new Map([
      ["x", new Set(["a|1"])],
      ["y", new Set(["b|2"])],
    ]);
    expect(computeOverlaps(keysByFeed)).toEqual([]);
  });
});

function registryEntry(overrides: Partial<RegistryEntry>): RegistryEntry {
  return {
    id: "entity",
    name: "Entity",
    entity_type: "intergroup",
    state: "TN",
    website: null,
    feed_type: "tsml",
    feed_url: null,
    verified: true,
    meeting_count: 100,
    states_covered: [],
    cities_covered: [],
    checked_at: "2026-09-25",
    notes: "",
    ...overrides,
  };
}

describe("computeChanges", () => {
  it("flags a feed that stopped responding, a new entity, and a meeting-count drop over 30%", () => {
    const previous = [
      registryEntry({ id: "stopped", verified: true }),
      registryEntry({ id: "removed", verified: true }),
      registryEntry({ id: "steady", verified: true, meeting_count: 100 }),
      registryEntry({ id: "big-drop", verified: true, meeting_count: 100 }),
      registryEntry({ id: "small-drop", verified: true, meeting_count: 100 }),
    ];
    const current = [
      registryEntry({ id: "stopped", verified: false, feed_type: "none_found" }),
      registryEntry({ id: "steady", verified: true, meeting_count: 100 }),
      registryEntry({ id: "big-drop", verified: true, meeting_count: 60 }),
      registryEntry({ id: "small-drop", verified: true, meeting_count: 71 }),
      registryEntry({ id: "new-entity" }),
    ];

    expect(computeChanges(previous, current)).toEqual({
      stoppedResponding: ["stopped"],
      removedFromDirectory: ["removed"],
      newEntities: ["new-entity"],
      countDrops: [{ id: "big-drop", from: 100, to: 60 }],
    });
  });
});

describe("renderCoverage", () => {
  it("renders the coverage markdown exactly, for a two-state fixture", () => {
    const entries: RegistryEntry[] = [
      registryEntry({
        id: "some-county-intergroup",
        name: "Some County Intergroup",
        state: "TN",
        website: "https://example.org",
        feed_type: "tsml",
        feed_url: "https://example.org/wp-admin/admin-ajax.php?action=meetings",
        verified: true,
        meeting_count: 612,
        states_covered: ["TN"],
        cities_covered: ["Franklin, TN", "Nashville, TN"],
        checked_at: "2026-09-27",
        notes: "",
      }),
      registryEntry({
        id: "other-intergroup",
        name: "Other Intergroup",
        state: "TN",
        website: "https://other.example.org",
        feed_type: "restricted",
        feed_url: null,
        verified: false,
        meeting_count: 0,
        states_covered: [],
        cities_covered: [],
        checked_at: "2026-09-27",
        notes: "TSML feed restricted; contact the intergroup",
      }),
      registryEntry({
        id: "vermont-office",
        name: "Vermont Office",
        entity_type: "central_office",
        state: "VT",
        website: null,
        feed_type: "none_found",
        feed_url: null,
        verified: false,
        meeting_count: 0,
        states_covered: [],
        cities_covered: [],
        checked_at: "2026-09-27",
        notes: "no website listed",
      }),
    ];

    const markdown = renderCoverage(entries, [], {
      stoppedResponding: [],
      removedFromDirectory: [],
      newEntities: [],
      countDrops: [],
    });

    expect(markdown).toBe(`# Feed coverage

Checked 2026-09-27. 3 entities, 1 verified feed, 612 meetings.

| State | Entities | Verified feeds | Meetings | Restricted | No feed |
| ----- | -------- | -------------- | -------- | ---------- | ------- |
| TN    | 2        | 1              | 612      | 1          | 0       |
| VT    | 1        | 0              | 0        | 0          | 1       |

## Verified feeds (open to us)

| State | Site                | Feed | Meetings | States | Cities | Listed by              |
| ----- | ------------------- | ---- | -------- | ------ | ------ | ---------------------- |
| TN    | https://example.org | tsml | 612      | TN     | 2      | Some County Intergroup |

## Blocked by a bot check: ask the site to allow mymeetingapp's User-Agent

None.

## Restricted feeds (contact the intergroup)

- Other Intergroup (TN) — https://other.example.org

## No feed found (manual backlog)

- Vermont Office (VT) — no website listed

## Overlapping feeds

None.

## Changes since the last run

None.`);
  });

  it("counts a feed shared by several entities once, in the totals and the feed list", () => {
    const shared = {
      state: "VT",
      website: "http://www.aavt.org",
      feed_type: "tsml" as const,
      feed_url: "https://aavt.org/wp-admin/admin-ajax.php?action=meetings",
      verified: true,
      meeting_count: 526,
      states_covered: ["VT"],
      cities_covered: ["Burlington, VT"],
    };
    const markdown = renderCoverage(
      [
        registryEntry({ ...shared, id: "area-070-vermont", name: "Area 070 Vermont", entity_type: "area" }),
        registryEntry({ ...shared, id: "district-2", name: "District 2", entity_type: "district" }),
      ],
      [],
      { stoppedResponding: [], removedFromDirectory: [], newEntities: [], countDrops: [] },
    );

    expect(markdown).toContain("2 entities, 1 verified feed, 526 meetings.");
    expect(markdown).toContain("| VT    | 2        | 1              | 526      | 0          | 0       |");
    expect(markdown).toContain(
      "| VT    | http://www.aavt.org | tsml | 526      | VT     | 1      | Area 070 Vermont, District 2 |",
    );
  });

  it("lists entities removed from the directory apart from feeds that stopped responding", () => {
    const markdown = renderCoverage([registryEntry({})], [], {
      stoppedResponding: ["stopped"],
      removedFromDirectory: ["removed"],
      newEntities: [],
      countDrops: [],
    });
    expect(markdown.split("## Changes since the last run\n\n")[1]).toBe(
      "- Stopped responding: stopped\n- Removed from the directory: removed",
    );
  });

  it("lists bot-blocked sites under their own heading, apart from restricted feeds", () => {
    const markdown = renderCoverage(
      [
        registryEntry({
          id: "houston",
          name: "Houston Intergroup",
          state: "TX",
          website: "https://houston.example.org",
          feed_type: "bot_blocked",
        }),
        registryEntry({
          id: "western-co",
          name: "Western Colorado",
          state: "TX",
          website: "https://western-co.example.org",
          feed_type: "restricted",
        }),
      ],
      [],
      { stoppedResponding: [], removedFromDirectory: [], newEntities: [], countDrops: [] },
    );
    expect(markdown).toContain(
      "## Blocked by a bot check: ask the site to allow mymeetingapp's User-Agent\n\n- Houston Intergroup (TX) — https://houston.example.org",
    );
    expect(markdown).toContain(
      "## Restricted feeds (contact the intergroup)\n\n- Western Colorado (TX) — https://western-co.example.org",
    );
  });
});
