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
  cities_covered: [],
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
  cities_covered: [],
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
  cities_covered: [],
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
  cities_covered: [],
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

  it("seeds a restricted entry that has a feed_url as waiting for permission, and a re-seed never re-pauses it", async () => {
    const keyedOffice: RegistryEntry = {
      ...restricted,
      feed_url: "https://restricted.example.org/wp-json/tsml/meetings",
    };
    expect(await seedFeedsFromRegistry([keyedOffice])).toEqual({ upserted: 1, optedOut: 0, skipped: 0 });
    expect(await feedRow("tn-restricted")).toMatchObject({
      url: "https://restricted.example.org/wp-json/tsml/meetings",
      waitingReason: "restricted",
    });

    // The owner resumes it once the office sends a key; the registry still says restricted.
    await db.update(feeds).set({ waitingReason: null }).where(eq(feeds.slug, "tn-restricted"));
    await seedFeedsFromRegistry([keyedOffice]);
    expect(await feedRow("tn-restricted")).toMatchObject({ waitingReason: null });
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

  it("opts out a shared feed_url when any entry sharing it is opted out", async () => {
    const sharedUrl = "https://sharedsite.example.org/meetings.json";
    const intergroup: RegistryEntry = { ...verifiedTsml, id: "shared-intergroup", feed_url: sharedUrl };
    const area: RegistryEntry = {
      ...verifiedTsml,
      id: "shared-area",
      entity_type: "area",
      feed_url: sharedUrl,
      opted_out: true,
    };

    expect(await seedFeedsFromRegistry([intergroup, area])).toEqual({ upserted: 1, optedOut: 1, skipped: 1 });
    expect(await feedRow("shared-intergroup")).toMatchObject({ url: sharedUrl, optedOut: true });
  });

  it("moves a feed_url's existing row to a new winning id instead of violating feeds_url_unique", async () => {
    await seedFeedsFromRegistry([verifiedTsml]);
    const [before] = await db.select().from(feeds);

    const renamed: RegistryEntry = { ...verifiedTsml, id: "tn-intergroup-renamed" };
    expect(await seedFeedsFromRegistry([renamed])).toEqual({ upserted: 1, optedOut: 0, skipped: 0 });

    const rows = await db
      .select()
      .from(feeds)
      .where(eq(feeds.url, verifiedTsml.feed_url ?? ""));
    expect(rows).toEqual([expect.objectContaining({ id: before?.id, slug: "tn-intergroup-renamed" })]);
  });

  it("frees a winning id held by a row at another url instead of violating feeds_slug_unique", async () => {
    const urlX = "https://x.example.org/wp-json/tsml/meetings";
    const urlY = "https://y.example.org/wp-json/tsml/meetings";
    const area: RegistryEntry = { ...verifiedTsml, id: "a", entity_type: "area", feed_url: urlX };
    const intergroup: RegistryEntry = { ...verifiedTsml, id: "b", feed_url: urlY };
    await seedFeedsFromRegistry([area, intergroup]);
    const [rowY] = await db.select().from(feeds).where(eq(feeds.url, urlY));

    // Next month the intergroup publishes on X (it wins on priority) and Y is no longer verified.
    expect(await seedFeedsFromRegistry([area, { ...intergroup, feed_url: urlX }])).toEqual({
      upserted: 1,
      optedOut: 0,
      skipped: 1,
    });

    expect(await feedRow("b")).toMatchObject({ url: urlX });
    expect(await db.select().from(feeds).where(eq(feeds.url, urlY))).toEqual([
      expect.objectContaining({ id: rowY?.id, slug: `b-retired-${String(rowY?.id)}` }),
    ]);
  });

  it("swaps two entities' feed urls without violating feeds_slug_unique", async () => {
    const urlX = "https://x.example.org/wp-json/tsml/meetings";
    const urlY = "https://y.example.org/wp-json/tsml/meetings";
    const a: RegistryEntry = { ...verifiedTsml, id: "a", feed_url: urlX };
    const b: RegistryEntry = { ...verifiedTsml, id: "b", feed_url: urlY };
    await seedFeedsFromRegistry([a, b]);

    expect(
      await seedFeedsFromRegistry([
        { ...a, feed_url: urlY },
        { ...b, feed_url: urlX },
      ]),
    ).toEqual({
      upserted: 2,
      optedOut: 0,
      skipped: 0,
    });
    expect(await feedRow("a")).toMatchObject({ url: urlY });
    expect(await feedRow("b")).toMatchObject({ url: urlX });
  });

  it("seeds everything or nothing: a bad entry rolls back the ones before it", async () => {
    // A blank name passes the registry schema but not FeedInput, so the second upsert throws.
    const blankName: RegistryEntry = {
      ...verifiedTsml,
      id: "blank-name",
      name: " ",
      feed_url: "https://blank.example.org/wp-json/tsml/meetings",
    };

    await expect(seedFeedsFromRegistry([verifiedTsml, blankName])).rejects.toThrow();
    expect(await db.select().from(feeds)).toEqual([]);
  });
});
