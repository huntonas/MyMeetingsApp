import { eq } from "drizzle-orm";
import type { RegistryEntry } from "@mymeetingapp/feed-kit";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { feeds } from "@/db/schema";
import { seedFeedsFromRegistry } from "@/db/seed-feeds";

import { resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => pool.end());

async function feedRow(slug: string) {
  const [row] = await db.select().from(feeds).where(eq(feeds.slug, slug));
  return row;
}

const verifiedTsml: RegistryEntry = {
  id: "tn-intergroup",
  name: "Tennessee Area Intergroup",
  entity_type: "intergroup",
  state: "TN",
  website: "https://example.org",
  feed_type: "tsml",
  feed_url: "https://example.org/wp-json/tsml/meetings",
  verified: true,
  meeting_count: 120,
  states_covered: ["TN"],
  checked_at: "2026-09-25",
  notes: "",
};

const restricted: RegistryEntry = {
  id: "tn-restricted",
  name: "Restricted Office",
  entity_type: "central_office",
  state: "TN",
  website: "https://restricted.example.org",
  feed_type: "restricted",
  feed_url: null,
  verified: false,
  meeting_count: 0,
  states_covered: [],
  checked_at: "2026-09-25",
  notes: "requires approval",
};

const noneFound: RegistryEntry = {
  id: "tn-none-found",
  name: "No Site Found District",
  entity_type: "district",
  state: "TN",
  website: null,
  feed_type: "none_found",
  feed_url: null,
  verified: false,
  meeting_count: 0,
  states_covered: [],
  checked_at: "2026-09-25",
  notes: "no website listed",
};

const optedOutArea: RegistryEntry = {
  id: "tn-area",
  name: "Tennessee Area Assembly",
  entity_type: "area",
  state: "TN",
  website: "https://tn-area.example.org",
  feed_type: "google_sheet",
  feed_url: "https://docs.google.com/spreadsheets/d/abc123/export?format=csv",
  verified: true,
  meeting_count: 45,
  states_covered: ["TN"],
  checked_at: "2026-09-25",
  notes: "",
  opted_out: true,
};

describe("seedFeedsFromRegistry", () => {
  it("upserts verified entries, opts out flagged ones, and skips the rest", async () => {
    const entries = [verifiedTsml, restricted, noneFound, optedOutArea];

    expect(await seedFeedsFromRegistry(entries)).toEqual({ upserted: 2, optedOut: 1, skipped: 2 });

    expect(await feedRow("tn-intergroup")).toMatchObject({
      url: "https://example.org/wp-json/tsml/meetings",
      priority: 10,
      optedOut: false,
    });
    expect(await feedRow("tn-area")).toMatchObject({
      url: "https://docs.google.com/spreadsheets/d/abc123/export?format=csv",
      priority: 20,
      optedOut: true,
    });
    expect(await feedRow("tn-restricted")).toBeUndefined();
    expect(await feedRow("tn-none-found")).toBeUndefined();

    // Running it again against the same registry changes nothing.
    expect(await seedFeedsFromRegistry(entries)).toEqual({ upserted: 2, optedOut: 1, skipped: 2 });
    expect(await feedRow("tn-intergroup")).toMatchObject({ priority: 10, optedOut: false });
    expect(await feedRow("tn-area")).toMatchObject({ priority: 20, optedOut: true });
  });

  it("keeps the lower-priority entity when two entries share one feed_url", async () => {
    const sharedUrl = "https://sharedsite.example.org/meetings.json";
    const intergroup: RegistryEntry = {
      ...verifiedTsml,
      id: "shared-intergroup",
      feed_url: sharedUrl,
    };
    const area: RegistryEntry = {
      ...verifiedTsml,
      id: "shared-area",
      entity_type: "area",
      feed_url: sharedUrl,
    };

    expect(await seedFeedsFromRegistry([area, intergroup])).toEqual({
      upserted: 1,
      optedOut: 0,
      skipped: 1,
    });

    expect(await feedRow("shared-intergroup")).toMatchObject({ url: sharedUrl, priority: 10 });
    expect(await feedRow("shared-area")).toBeUndefined();
  });

  it("breaks a same-priority tie for a shared feed_url by id, alphabetically", async () => {
    const sharedUrl = "https://sharedsite.example.org/meetings.json";
    const higherId: RegistryEntry = { ...verifiedTsml, id: "tn-intergroup-b", feed_url: sharedUrl };
    const lowerId: RegistryEntry = { ...verifiedTsml, id: "tn-intergroup-a", feed_url: sharedUrl };

    // Passed with the higher id first, so the result only matches if the tie-break (not array order)
    // decided the winner.
    expect(await seedFeedsFromRegistry([higherId, lowerId])).toEqual({
      upserted: 1,
      optedOut: 0,
      skipped: 1,
    });

    expect(await feedRow("tn-intergroup-a")).toMatchObject({ url: sharedUrl, priority: 10 });
    expect(await feedRow("tn-intergroup-b")).toBeUndefined();
  });
});
