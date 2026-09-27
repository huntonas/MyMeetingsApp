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
    checked_at: "2026-09-25",
    notes: "",
    ...overrides,
  };
}

describe("computeChanges", () => {
  it("flags a feed that stopped responding, a new entity, and a meeting-count drop over 30%", () => {
    const previous = [
      registryEntry({ id: "stopped", verified: true }),
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
        checked_at: "2026-09-27",
        notes: "no website listed",
      }),
    ];

    const markdown = renderCoverage(entries, [], {
      stoppedResponding: [],
      newEntities: [],
      countDrops: [],
    });

    expect(markdown).toBe(`# Feed coverage

Checked 2026-09-27. 3 entities, 1 verified feed, 612 meetings.

| State | Entities | Verified feeds | Meetings | Restricted | No feed |
| ----- | -------- | -------------- | -------- | ---------- | ------- |
| TN    | 2        | 1              | 612      | 1          | 0       |
| VT    | 1        | 0              | 0        | 0          | 1       |

## Restricted feeds (contact the intergroup)

- Other Intergroup (TN) — https://other.example.org

## No feed found (manual backlog)

- Vermont Office (VT) — no website listed

## Overlapping feeds

None.

## Changes since the last run

None.`);
  });
});
