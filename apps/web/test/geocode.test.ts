import { createHostThrottle } from "@mymeetingapp/feed-kit";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { addressGeocodes, meetings } from "@/db/schema";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";
import { geocodePendingAddresses } from "@/server/meetings/geocode";

import { resetDb } from "./db";
import { feedMeeting, seedFeed } from "./feed-fixtures";
import { startServer } from "@mymeetingapp/test-server";

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => pool.end());

const matched = {
  result: {
    addressMatches: [
      { matchedAddress: "1 MAIN ST, NASHVILLE, TN, 37203", coordinates: { x: -86.781, y: 36.162 } },
    ],
  },
};
const noMatch = { result: { addressMatches: [] } };

describe("geocodePendingAddresses", () => {
  it("stores results, fills the meeting's coordinates and never asks twice", async () => {
    const server = await startServer((path) => ({
      status: 200,
      body: JSON.stringify(path.includes("Nowhere") ? noMatch : matched),
    }));
    vi.stubEnv("CENSUS_GEOCODER_URL", `${server.baseUrl}/geocode`);
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [
      feedMeeting({ latitude: null, longitude: null }),
      feedMeeting({
        sourceSlug: "b",
        formattedAddress: "9 Nowhere Rd",
        addressKey: "9 nowhere rd",
        latitude: null,
        longitude: null,
      }),
    ]);

    expect(await geocodePendingAddresses(createHostThrottle(), Date.now() + 60_000)).toBe(2);
    expect(await geocodePendingAddresses(createHostThrottle(), Date.now() + 60_000)).toBe(0);
    await server.close();

    expect(
      await db
        .select({ key: addressGeocodes.addressKey, status: addressGeocodes.status })
        .from(addressGeocodes)
        .orderBy(addressGeocodes.addressKey),
    ).toEqual([
      { key: "1 main st nashville tn 37203", status: "matched" },
      { key: "9 nowhere rd", status: "no_match" },
    ]);
    const [located] = await db.select().from(meetings).where(eq(meetings.latitude, 36.162));
    expect(located).toMatchObject({ longitude: -86.781, timezone: "America/Chicago" });
    expect(server.requests[0]?.path).toContain("benchmark=Public_AR_Current");
  });

  it("stores nothing when the geocoder is unreachable, so the next run retries", async () => {
    vi.stubEnv("CENSUS_GEOCODER_URL", "http://127.0.0.1:9/geocode");
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting({ latitude: null, longitude: null })]);
    expect(await geocodePendingAddresses(createHostThrottle(), Date.now() + 60_000)).toBe(0);
    expect(await db.select().from(addressGeocodes)).toEqual([]);
  });

  it("does nothing once the deadline has passed", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting({ latitude: null, longitude: null })]);
    expect(await geocodePendingAddresses(createHostThrottle(), Date.now() - 1)).toBe(0);
  });

  it.each([
    ["an empty object body", JSON.stringify({})],
    ["a null body", JSON.stringify(null)],
    [
      "non-numeric coordinates",
      JSON.stringify({ result: { addressMatches: [{ coordinates: { x: "a", y: 1 } }] } }),
    ],
  ])("records no_match, with no coordinates, for %s", async (_label, body) => {
    const server = await startServer(() => ({ status: 200, body }));
    vi.stubEnv("CENSUS_GEOCODER_URL", `${server.baseUrl}/geocode`);
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting({ latitude: null, longitude: null })]);

    expect(await geocodePendingAddresses(createHostThrottle(), Date.now() + 60_000)).toBe(1);
    await server.close();

    expect(await db.select().from(addressGeocodes)).toEqual([
      expect.objectContaining({ status: "no_match", latitude: null, longitude: null }),
    ]);
  });
});
