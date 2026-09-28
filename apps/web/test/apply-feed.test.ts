import { addressKey } from "@mymeetingapp/feed-kit";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { feedMeetings, meetings } from "@/db/schema";
import type { FeedMeeting } from "@/server/feeds/normalize";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";
import { recomputeMeetings } from "@/server/meetings/recompute";

import { resetDb } from "./db";
import { feedMeeting, insertMeetingWithSources, seedFeed } from "./feed-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

async function activeMeetings() {
  return db.select().from(meetings).where(isNull(meetings.archivedAt));
}

async function meetingIdOf(feedId: number, sourceSlug: string) {
  const [row] = await db
    .select({ meetingId: feedMeetings.meetingId })
    .from(feedMeetings)
    .where(and(eq(feedMeetings.feedId, feedId), eq(feedMeetings.sourceSlug, sourceSlug)));
  return row?.meetingId;
}

const online = {
  attendance: "online",
  formattedAddress: null,
  addressKey: null,
  latitude: null,
  longitude: null,
  conferenceUrl: "https://zoom.us/j/1",
} as const;

// A degree of latitude is about 111 km, so this is a point the given distance due north of another.
function northOf(latitude: number, meters: number) {
  return latitude + meters / 111_000;
}

function listing(name: string, formattedAddress: string, latitude: number, longitude: number) {
  return { name, formattedAddress, addressKey: addressKey(formattedAddress), latitude, longitude };
}

// Each active meeting's sources' types, e.g. [["M", "M"], ["W", "W"]] for two single-gender meetings.
async function typesByMeeting() {
  const rows = await db
    .select({ meetingId: feedMeetings.meetingId, types: feedMeetings.types })
    .from(feedMeetings)
    .innerJoin(meetings, eq(meetings.id, feedMeetings.meetingId))
    .where(isNull(meetings.archivedAt));
  const byMeeting = new Map<string, string[]>();
  for (const row of rows) {
    byMeeting.set(row.meetingId, [...(byMeeting.get(row.meetingId) ?? []), row.types.join(",")]);
  }
  return [...byMeeting.values()].map((types) => types.sort()).sort();
}

describe("applyFeedSnapshot", () => {
  it("creates one canonical meeting per row", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting(), feedMeeting({ sourceSlug: "other", day: 2 })]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("is idempotent", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting()]);
    await applyFeedSnapshot(feedId, [feedMeeting()]);
    expect(await activeMeetings()).toHaveLength(1);
    expect(await db.select().from(feedMeetings)).toHaveLength(1);
  });

  it("joins the same meeting from another feed by normalized address", async () => {
    const intergroup = await seedFeed("intergroup");
    const area = await seedFeed("area", "area");
    await applyFeedSnapshot(intergroup, [feedMeeting()]);
    await applyFeedSnapshot(area, [
      feedMeeting({ sourceSlug: "area-slug", latitude: null, longitude: null }),
    ]);
    expect(await activeMeetings()).toHaveLength(1);
    expect(await meetingIdOf(area, "area-slug")).toBe(await meetingIdOf(intergroup, "nooners"));
  });

  it("joins by coordinates within 50 m when the addresses differ", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting()]);
    await applyFeedSnapshot(b, [
      feedMeeting({ sourceSlug: "b", addressKey: "different", latitude: 36.1702, longitude: -86.78 }),
    ]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it.each([
    {
      meters: 82,
      first: ["Heritage", "1177 Gregorie Ferry Rd, Mt Pleasant, SC 29466, USA", 32.8468, -79.8231],
      second: ["Heritage", "1177 Gregorie Ferry Rd, Mount Pleasant, SC 29466, USA"],
    },
    {
      meters: 128,
      first: ["DOUGLASTON FRESH START", "243-01 Northern Blvd, Douglaston, NY 11363, USA", 40.7627, -73.744],
      second: ["Douglaston Fresh Start", "243-1 Northern Blvd, Little Neck, NY 11362, USA"],
    },
    {
      meters: 83,
      first: ["Central", "117 W Calhoun Street, Anderson, SC 29621, USA", 34.5034, -82.6501],
      second: ["Central Group - Anderson", "117 W Calhoun St, Anderson, SC 29625, USA"],
    },
    {
      meters: 61,
      first: ["Belleville Sunday 11th Step", "373 W Columbia Ave, Belleville, MI 48111", 42.2048, -83.4852],
      second: ["Sunday 11th Step", "409 W Columbia Ave, Belleville, MI 48111"],
    },
    {
      meters: 79,
      first: [
        "Rockaway Big Book Group",
        "100 Beach 116th St, Rockaway Park, NY 11694, USA",
        40.5795,
        -73.837,
      ],
      second: ["ROCKAWAY BIG BOOK", "100 Beach 116th St, Queens, NY 11694, USA"],
    },
  ] as const)(
    "joins $second.0 to $first.0 $meters m away at the same time",
    async ({ meters, first, second }) => {
      const [name, address, latitude, longitude] = first;
      const [otherName, otherAddress] = second;
      const a = await seedFeed("a");
      const b = await seedFeed("b");
      await applyFeedSnapshot(a, [feedMeeting(listing(name, address, latitude, longitude))]);
      await applyFeedSnapshot(b, [
        feedMeeting({
          sourceSlug: "b",
          ...listing(otherName, otherAddress, northOf(latitude, meters), longitude),
        }),
      ]);
      expect(await activeMeetings()).toHaveLength(1);
    },
  );

  it.each([
    ["Stepping Stones", "Steping Stones", 1],
    ["The Big Book", "Big Book Meeting", 1],
    ["Joy", "Joyful Living", 2],
    ["Hope", "Hopeful Hearts", 2],
    ["Men's Stag", "Women's Stag", 2],
    ["Women's Serenity", "Serenity", 2],
    ["Men Stag", "Men's Stag", 1],
    ["Grupo Español", "Grupo Espanol", 1],
  ])("matches %j and %j 100 m apart into %i meeting(s)", async (first, second, expected) => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [
      feedMeeting(listing(first, "500 E Main St, Nashville, TN 37206, USA", 36.17, -86.78)),
    ]);
    await applyFeedSnapshot(b, [
      feedMeeting({
        sourceSlug: "b",
        ...listing(second, "520 E Main St, Nashville, TN 37206, USA", northOf(36.17, 100), -86.78),
      }),
    ]);
    expect(await activeMeetings()).toHaveLength(expected);
  });

  it("keeps the same name apart more than 150 m away", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [
      feedMeeting(
        listing("Heritage", "1177 Gregorie Ferry Rd, Mt Pleasant, SC 29466, USA", 32.8468, -79.8231),
      ),
    ]);
    await applyFeedSnapshot(b, [
      feedMeeting({
        sourceSlug: "b",
        ...listing(
          "Heritage",
          "1250 Gregorie Ferry Rd, Mt Pleasant, SC 29466, USA",
          northOf(32.8468, 160),
          -79.8231,
        ),
      }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("keeps different names at the same time within 150 m apart", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [
      feedMeeting(listing("Men's Stag", "500 E Main St, Nashville, TN 37206, USA", 36.17, -86.78)),
    ]);
    await applyFeedSnapshot(b, [
      feedMeeting({
        sourceSlug: "b",
        ...listing(
          "Women's Serenity",
          "520 E Main St, Nashville, TN 37206, USA",
          northOf(36.17, 100),
          -86.78,
        ),
      }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("keeps a men's and a women's meeting at one address and time apart", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const church = listing("Grupo Hombres", "1 Main St, Nashville, TN 37203, USA", 36.17, -86.78);
    await applyFeedSnapshot(a, [feedMeeting(church)]);
    await applyFeedSnapshot(b, [feedMeeting({ ...church, sourceSlug: "b", name: "Grupo Mujeres" })]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it.each([
    ["Sisters in Sobriety", "Brothers in Sobriety", 2],
    ["Girls Night Out", "Guys Night Out", 2],
    ["Open Discussion", "Discussion", 1],
  ])("matches %j and %j at one address and time into %i meeting(s)", async (first, second, expected) => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting({ name: first })]);
    await applyFeedSnapshot(b, [feedMeeting({ sourceSlug: "b", name: second })]);
    expect(await activeMeetings()).toHaveLength(expected);
  });

  it("pairs two feeds' men's and women's listings at one address by their types", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const menFirst = feedMeeting({ sourceSlug: "a-men", name: "Big Book", types: ["M"] });
    await applyFeedSnapshot(a, [menFirst]);
    await applyFeedSnapshot(a, [
      menFirst,
      feedMeeting({ sourceSlug: "a-women", name: "Big Book", types: ["W"] }),
    ]);
    await applyFeedSnapshot(b, [
      feedMeeting({ sourceSlug: "b-women", name: "Big Book", types: ["W"] }),
      feedMeeting({ sourceSlug: "b-men", name: "Big Book", types: ["M"] }),
    ]);
    expect(await typesByMeeting()).toEqual([
      ["M", "M"],
      ["W", "W"],
    ]);
  });

  it("treats a men's name and the M type as the same audience", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting({ name: "Men's Big Book", types: [] })]);
    await applyFeedSnapshot(b, [feedMeeting({ sourceSlug: "b", name: "Big Book", types: ["M"] })]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("joins listings of one Zoom meeting even when only one name has an audience word", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting({ ...online, name: "Women's Serenity" })]);
    await applyFeedSnapshot(b, [feedMeeting({ ...online, sourceSlug: "b", name: "Serenity" })]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("keeps meetings in one building apart when their start times differ", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const lansing = listing("12 X 12", "2909 W Genesee St, Lansing, MI 48917, USA", 42.7432, -84.5917);
    await applyFeedSnapshot(a, [feedMeeting({ ...lansing, day: 0, time: "10:00" })]);
    await applyFeedSnapshot(b, [
      feedMeeting({ ...lansing, sourceSlug: "b", name: "Sunday Morning Live", day: 0, time: "10:30" }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("keeps meetings apart when the time differs or they are more than 50 m apart", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting()]);
    await applyFeedSnapshot(b, [
      feedMeeting({ sourceSlug: "later", time: "12:30" }),
      feedMeeting({ sourceSlug: "far", addressKey: "elsewhere", latitude: 36.18, longitude: -86.78 }),
    ]);
    expect(await activeMeetings()).toHaveLength(3);
  });

  it("joins online-only meetings by conference URL", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting({ ...online })]);
    await applyFeedSnapshot(b, [feedMeeting({ ...online, sourceSlug: "b" })]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it.each([
    ["https://us02web.zoom.us/j/740716108", "https://zoom.us/j/740716108"],
    ["https://zoom.us/j/139383779", "https://zoom.us/j/139383779%20"],
    ["https://us02web.zoom.us/j/2014115493?pwd=Y0sy#success", "https://us02web.zoom.us/j/2014115493"],
    ["https://us04web.zoom.us/j/83492157355", "https://zoom.us/j/83492157355"],
    ["https://us06web.zoom.us/my/Serenity.Now", "https://zoom.us/my/serenity.now"],
    ["https://meet.google.com/abc-defg-hij", " HTTPS://Meet.Google.com/abc-defg-hij/#join "],
  ])("joins online meetings whose conference URLs %s and %s name the same room", async (first, second) => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting({ ...online, conferenceUrl: first })]);
    await applyFeedSnapshot(b, [feedMeeting({ ...online, sourceSlug: "b", conferenceUrl: second })]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("keeps online meetings with different Zoom ids at the same time apart", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting({ ...online, conferenceUrl: "https://zoom.us/j/740716108" })]);
    await applyFeedSnapshot(b, [
      feedMeeting({ ...online, sourceSlug: "b", conferenceUrl: "https://us02web.zoom.us/j/740716109" }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("merges one conference URL listed under two slugs in one feed at the same day and time", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [
      feedMeeting({ ...online, sourceSlug: "listing-a" }),
      feedMeeting({ ...online, sourceSlug: "listing-b" }),
    ]);
    expect(await activeMeetings()).toHaveLength(1);
    expect(await meetingIdOf(feedId, "listing-b")).toBe(await meetingIdOf(feedId, "listing-a"));
  });

  it("merges two slugs in one feed whose Zoom URLs differ only in host", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [
      feedMeeting({
        ...online,
        sourceSlug: "listing-a",
        conferenceUrl: "https://us02web.zoom.us/j/740716108",
      }),
      feedMeeting({ ...online, sourceSlug: "listing-b", conferenceUrl: "https://zoom.us/j/740716108" }),
    ]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("keeps two Webex meetings in one feed apart when their URLs differ only in the query", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [
      feedMeeting({
        ...online,
        sourceSlug: "a",
        conferenceUrl: "https://example.webex.com/example/j.php?MTID=m1111",
      }),
      feedMeeting({
        ...online,
        sourceSlug: "b",
        conferenceUrl: "https://example.webex.com/example/j.php?MTID=m2222",
      }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("merges a meeting one feed calls online and another calls hybrid, by conference URL", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting({ ...online })]);
    await applyFeedSnapshot(b, [
      feedMeeting({
        sourceSlug: "b",
        attendance: "hybrid",
        addressKey: "somewhere else entirely",
        latitude: 40,
        longitude: -80,
        conferenceUrl: "https://zoom.us/j/1",
      }),
    ]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("joins an active meeting rather than an older archived one at the same place and time", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const archived = await insertMeetingWithSources([
      { feedId: a, row: feedMeeting({ sourceSlug: "gone" }), archived: true },
    ]);
    const active = await insertMeetingWithSources([{ feedId: b, row: feedMeeting({ sourceSlug: "live" }) }]);
    await recomputeMeetings([archived, active]);
    const c = await seedFeed("c");
    await applyFeedSnapshot(c, [feedMeeting({ sourceSlug: "new" })]);
    expect(await meetingIdOf(c, "new")).toBe(active);
  });

  it("keeps a renamed meeting (new slug) on the same canonical meeting", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting({ sourceSlug: "old-name" })]);
    const before = await meetingIdOf(feedId, "old-name");
    await applyFeedSnapshot(feedId, [feedMeeting({ sourceSlug: "new-name" })]);
    expect(await meetingIdOf(feedId, "new-name")).toBe(before);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("keeps two rooms at one address and time apart when the feed lists both", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [
      feedMeeting({ sourceSlug: "room-a" }),
      feedMeeting({ sourceSlug: "room-b" }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("archives rows missing from the snapshot and restores them when they return", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting(), feedMeeting({ sourceSlug: "gone", day: 3 })]);
    const goneId = await meetingIdOf(feedId, "gone");
    await applyFeedSnapshot(feedId, [feedMeeting()]);
    expect(await activeMeetings()).toHaveLength(1);
    await applyFeedSnapshot(feedId, [feedMeeting(), feedMeeting({ sourceSlug: "gone", day: 3 })]);
    expect(await meetingIdOf(feedId, "gone")).toBe(goneId);
    expect(await activeMeetings()).toHaveLength(2);
  });
});

describe("applyFeedSnapshot merging stored duplicates", () => {
  const heritage = listing(
    "Heritage",
    "1177 Gregorie Ferry Rd, Mt Pleasant, SC 29466, USA",
    32.8468,
    -79.8231,
  );
  const heritageNearby = listing(
    "Heritage",
    "1177 Gregorie Ferry Rd, Mount Pleasant, SC 29466, USA",
    northOf(32.8468, 82),
    -79.8231,
  );

  async function storedMeeting(feedId: number, row: FeedMeeting, createdAt?: string) {
    const id = await insertMeetingWithSources([{ feedId, row }]);
    if (createdAt !== undefined) {
      await db
        .update(meetings)
        .set({ createdAt: new Date(createdAt) })
        .where(eq(meetings.id, id));
    }
    await recomputeMeetings([id]);
    return id;
  }

  async function sourcesOf(meetingId: string) {
    const rows = await db
      .select({ sourceSlug: feedMeetings.sourceSlug })
      .from(feedMeetings)
      .where(eq(feedMeetings.meetingId, meetingId));
    return rows.map((row) => row.sourceSlug).sort();
  }

  it("merges two stored meetings into the older one when one of their feeds next syncs", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const newer = await storedMeeting(a, feedMeeting({ ...heritage, sourceSlug: "heritage-a" }));
    const older = await storedMeeting(
      b,
      feedMeeting({ ...heritageNearby, sourceSlug: "heritage-b" }),
      "2026-01-01T00:00:00Z",
    );
    await applyFeedSnapshot(a, [feedMeeting({ ...heritage, sourceSlug: "heritage-a" })]);
    expect((await activeMeetings()).map((meeting) => meeting.id)).toEqual([older]);
    expect(await sourcesOf(older)).toEqual(["heritage-a", "heritage-b"]);
    expect(await db.select().from(meetings).where(eq(meetings.id, newer))).toEqual([]);
  });

  it("merges three stored copies of one meeting into the oldest", async () => {
    const [a, b, c] = [await seedFeed("a"), await seedFeed("b"), await seedFeed("c")];
    const oldest = await storedMeeting(b, feedMeeting({ sourceSlug: "b" }), "2026-01-01T00:00:00Z");
    await storedMeeting(a, feedMeeting({ sourceSlug: "a" }), "2026-02-01T00:00:00Z");
    await storedMeeting(c, feedMeeting({ sourceSlug: "c" }), "2026-03-01T00:00:00Z");
    await applyFeedSnapshot(c, [feedMeeting({ sourceSlug: "c" })]);
    expect((await activeMeetings()).map((meeting) => meeting.id)).toEqual([oldest]);
    expect(await sourcesOf(oldest)).toEqual(["a", "b", "c"]);
  });

  it("never merges two rooms that one feed lists under two slugs", async () => {
    const feedId = await seedFeed("a");
    await storedMeeting(feedId, feedMeeting({ sourceSlug: "room-a" }));
    await storedMeeting(feedId, feedMeeting({ sourceSlug: "room-b" }));
    await applyFeedSnapshot(feedId, [
      feedMeeting({ sourceSlug: "room-a" }),
      feedMeeting({ sourceSlug: "room-b" }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("merges stored men's and women's listings by their types, never across them", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const bigBook = (sourceSlug: string, type: "M" | "W") =>
      feedMeeting({ sourceSlug, name: "Big Book", types: [type] });
    await storedMeeting(b, bigBook("b-women", "W"), "2026-01-01T00:00:00Z");
    await storedMeeting(b, bigBook("b-men", "M"), "2026-02-01T00:00:00Z");
    await storedMeeting(a, bigBook("a-men", "M"), "2026-03-01T00:00:00Z");
    await storedMeeting(a, bigBook("a-women", "W"), "2026-04-01T00:00:00Z");
    await applyFeedSnapshot(a, [bigBook("a-men", "M"), bigBook("a-women", "W")]);
    expect(await typesByMeeting()).toEqual([
      ["M", "M"],
      ["W", "W"],
    ]);
  });

  it("keeps a feed's two rooms apart after it briefly drops one that another feed also lists", async () => {
    const x = await seedFeed("x");
    const y = await seedFeed("y");
    const roomA = feedMeeting({ sourceSlug: "room-a" });
    const roomB = feedMeeting({ sourceSlug: "room-b" });
    await storedMeeting(x, roomA, "2026-01-01T00:00:00Z");
    const meetingB = await insertMeetingWithSources([
      { feedId: x, row: roomB },
      { feedId: y, row: feedMeeting({ sourceSlug: "y" }) },
    ]);
    await recomputeMeetings([meetingB]);
    await applyFeedSnapshot(x, [roomA]);
    await applyFeedSnapshot(x, [roomA, roomB]);
    expect(await activeMeetings()).toHaveLength(2);
    expect(await sourcesOf(meetingB)).toEqual(["room-b", "y"]);
  });

  it("merges only one of a feed's two rooms into a third meeting that matches both", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const third = await storedMeeting(b, feedMeeting({ sourceSlug: "b" }), "2026-01-01T00:00:00Z");
    await storedMeeting(a, feedMeeting({ sourceSlug: "room-a" }), "2026-02-01T00:00:00Z");
    const roomB = await storedMeeting(a, feedMeeting({ sourceSlug: "room-b" }), "2026-03-01T00:00:00Z");
    await applyFeedSnapshot(a, [
      feedMeeting({ sourceSlug: "room-a" }),
      feedMeeting({ sourceSlug: "room-b" }),
    ]);
    expect(await sourcesOf(third)).toEqual(["b", "room-a"]);
    expect(await sourcesOf(roomB)).toEqual(["room-b"]);
  });

  it("merges two slugs in one feed that share a conference key", async () => {
    const feedId = await seedFeed("a");
    const first = {
      ...online,
      sourceSlug: "listing-a",
      conferenceUrl: "https://us02web.zoom.us/j/740716108",
    };
    const second = { ...online, sourceSlug: "listing-b", conferenceUrl: "https://zoom.us/j/740716108" };
    await storedMeeting(feedId, feedMeeting(first));
    await storedMeeting(feedId, feedMeeting(second));
    await applyFeedSnapshot(feedId, [feedMeeting(first), feedMeeting(second)]);
    expect(await activeMeetings()).toHaveLength(1);
  });
});
