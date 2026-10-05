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
    ["Women's Serenity", "Serenity", 1],
    ["Men Stag", "Men's Stag", 1],
    // "Stag" means single-gender, not men: a women's stag is a women's meeting.
    ["Compton Women's Stag", "Compton Women's", 1],
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

  // Review Focus 3.
  it("keeps an AA and an NA meeting at one church, day and time apart", async () => {
    const aa = await seedFeed("aa-intergroup");
    const na = await seedFeed("na-region", "region", "na");
    const church = listing(
      "Recovery Is Possible",
      "34 Oak Tree Dr, McMinnville, TN 37110",
      35.7064,
      -85.8471,
    );
    await applyFeedSnapshot(aa, [feedMeeting(church)]);
    await applyFeedSnapshot(na, [feedMeeting({ ...church, sourceSlug: "1525" })]);
    expect((await activeMeetings()).map((meeting) => meeting.fellowship).sort()).toEqual(["aa", "na"]);
  });

  it("still joins two NA feeds' listings of one meeting", async () => {
    const a = await seedFeed("na-region", "region", "na");
    const b = await seedFeed("na-zone", "region", "na");
    const church = listing(
      "Gift of Desperation",
      "4001 Rossville Blvd, Chattanooga, TN 37407",
      34.9974,
      -85.2917,
    );
    await applyFeedSnapshot(a, [feedMeeting(church)]);
    await applyFeedSnapshot(b, [feedMeeting({ ...church, sourceSlug: "1481" })]);
    expect(await activeMeetings()).toEqual([expect.objectContaining({ fellowship: "na" })]);
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

  it.each([
    ["Nueva Vida", ["S", "O"], "Nueva Vida", ["O"]],
    ["Big Book", ["M"], "Big Book", []],
  ] as const)(
    "joins %j typed %j to %j typed %j at one address, since one side names no audience",
    async (firstName, firstTypes, secondName, secondTypes) => {
      const a = await seedFeed("a");
      const b = await seedFeed("b");
      await applyFeedSnapshot(a, [feedMeeting({ name: firstName, types: [...firstTypes] })]);
      await applyFeedSnapshot(b, [
        feedMeeting({ sourceSlug: "b", name: secondName, types: [...secondTypes] }),
      ]);
      expect(await activeMeetings()).toHaveLength(1);
    },
  );

  it("keeps a women's listing out of a meeting that a men's and an untyped listing share", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const c = await seedFeed("c");
    await applyFeedSnapshot(a, [feedMeeting({ sourceSlug: "a", name: "Big Book", types: ["M"] })]);
    await applyFeedSnapshot(b, [feedMeeting({ sourceSlug: "b", name: "Big Book", types: [] })]);
    await applyFeedSnapshot(c, [feedMeeting({ sourceSlug: "c", name: "Big Book", types: ["W"] })]);
    expect(await typesByMeeting()).toEqual([["", "M"], ["W"]]);
  });

  it.each(["M", "W"] as const)(
    "never adds a %s listing to a stored meeting whose listings already name different audiences",
    async (type) => {
      const a = await seedFeed("a");
      const b = await seedFeed("b");
      const c = await seedFeed("c");
      const mixed = await insertMeetingWithSources([
        { feedId: a, row: feedMeeting({ sourceSlug: "a", name: "Big Book", types: ["M"] }) },
        { feedId: b, row: feedMeeting({ sourceSlug: "b", name: "Big Book", types: ["W"] }) },
      ]);
      await recomputeMeetings([mixed]);
      await applyFeedSnapshot(c, [feedMeeting({ sourceSlug: "c", name: "Big Book", types: [type] })]);
      expect(await meetingIdOf(c, "c")).not.toBe(mixed);
      expect(await activeMeetings()).toHaveLength(2);
    },
  );

  it.each([
    ["Acceptance", ["C", "D", "LGBTQ", "X"], ["C", "G", "LGBTQ", "L"]],
    ["Young People of Greenville", ["O", "Y", "X"], ["B", "D", "LGBTQ", "Y"]],
  ] as const)(
    "joins %j listings whose non-gender audience types differ",
    async (name, firstTypes, secondTypes) => {
      const a = await seedFeed("a");
      const b = await seedFeed("b");
      await applyFeedSnapshot(a, [feedMeeting({ name, types: [...firstTypes] })]);
      await applyFeedSnapshot(b, [feedMeeting({ sourceSlug: "b", name, types: [...secondTypes] })]);
      expect(await activeMeetings()).toHaveLength(1);
    },
  );

  it("joins a listing for both men and women to an untyped one at the same address", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting({ name: "Men's and Women's Big Book", types: [] })]);
    await applyFeedSnapshot(b, [feedMeeting({ sourceSlug: "b", name: "Big Book", types: [] })]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("joins one Zoom meeting listed with different senior and young people types", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const zoom = { ...online, name: "COME ONE, COME ALL", conferenceUrl: "https://zoom.us/j/7777" };
    await applyFeedSnapshot(a, [feedMeeting({ ...zoom, types: ["D", "SEN", "SP", "Y"] })]);
    await applyFeedSnapshot(b, [feedMeeting({ ...zoom, sourceSlug: "b", types: ["D", "O", "SP", "Y"] })]);
    expect(await activeMeetings()).toHaveLength(1);
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

  it.each([
    "https://zoom.us/join",
    "https://us02web.zoom.us/",
    "https://zoom.us",
    "https://meet.google.com/",
    "https://zoom.us/join/",
    "https://zoom.us/j/",
    "https://us02web.zoom.us/join?_ics=abc123",
  ])("gives the placeholder conference URL %s no conference key", async (conferenceUrl) => {
    await applyFeedSnapshot(await seedFeed("a"), [feedMeeting({ ...online, conferenceUrl })]);
    expect(await db.select({ key: feedMeetings.conferenceKey }).from(feedMeetings)).toEqual([{ key: null }]);
  });

  it.each([
    ["https://us02web.zoom.us/j8265745930", "zoom:8265745930"],
    ["https://app.zoom.us/wc/81234567890/join?fromPWA=1&pwd=abc", "zoom:81234567890"],
    ["https://zoom.us/wc/join/81234567890", "zoom:81234567890"],
    ["https://zoom.us/812345678", "zoom:812345678"],
    ["https://zoom.us/meeting/81234567890", "zoom:81234567890"],
    ["https://us04web.zoom.us/meeting/register/tZAkcO2trD8tHNQ", "zoom:register:tzakco2trd8thnq"],
    ["https://zoom.us/join?confno=81234567890", "zoom:81234567890"],
  ])("keys the Zoom URL %s as %s", async (conferenceUrl, key) => {
    await applyFeedSnapshot(await seedFeed("a"), [feedMeeting({ ...online, conferenceUrl })]);
    expect(await db.select({ key: feedMeetings.conferenceKey }).from(feedMeetings)).toEqual([{ key }]);
  });

  it("joins two feeds' listings of one Zoom meeting written without a slash after /j", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const zoom = {
      ...online,
      name: "Acceptance is the Answer (online only)",
      conferenceUrl: "https://us02web.zoom.us/j8265745930",
    };
    await applyFeedSnapshot(a, [feedMeeting(zoom)]);
    await applyFeedSnapshot(b, [feedMeeting({ ...zoom, sourceSlug: "b" })]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("keeps unrelated online meetings that share a placeholder Zoom URL apart", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const placeholder = { ...online, conferenceUrl: "https://zoom.us/join" };
    await applyFeedSnapshot(a, [feedMeeting({ ...placeholder, name: "Sapphire Street Zoom" })]);
    await applyFeedSnapshot(b, [
      feedMeeting({ ...placeholder, sourceSlug: "b", name: "The Stick It", types: ["W"] }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
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

  it("keeps one feed's two hybrid venues 3.7 km apart that share a Zoom meeting apart", async () => {
    const feedId = await seedFeed("south-eastern-pa");
    const zoom = { attendance: "hybrid", conferenceUrl: "https://zoom.us/j/81234567890" } as const;
    await applyFeedSnapshot(feedId, [
      feedMeeting({
        ...zoom,
        sourceSlug: "lansdale-luncheon",
        ...listing("Lansdale Luncheon", "1 E Main St, Lansdale, PA 19446, USA", 40.2415, -75.2838),
      }),
      feedMeeting({
        ...zoom,
        sourceSlug: "north-wales-midday",
        ...listing(
          "North Wales Midday",
          "1 S Main St, North Wales, PA 19454, USA",
          northOf(40.2415, 3700),
          -75.2838,
        ),
      }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("joins two hybrid venues 50 m apart that share a Zoom meeting", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const zoom = { attendance: "hybrid", conferenceUrl: "https://zoom.us/j/81234567890" } as const;
    await applyFeedSnapshot(a, [
      feedMeeting({
        ...zoom,
        ...listing("Happy Hour", "1307 W 6th St, Corona, CA 92882, USA", 33.88, -117.58),
      }),
    ]);
    await applyFeedSnapshot(b, [
      feedMeeting({
        ...zoom,
        sourceSlug: "b",
        ...listing("Sunset Serenity", "1311 W 6th St, Corona, CA 92882, USA", northOf(33.88, 50), -117.58),
      }),
    ]);
    expect(await activeMeetings()).toHaveLength(1);
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

  async function storedMeetingWith(sources: { feedId: number; row: FeedMeeting }[]) {
    const id = await insertMeetingWithSources(sources);
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

  it("never merges a stored AA meeting and a stored NA meeting", async () => {
    const aa = await seedFeed("a");
    const na = await seedFeed("n", "region", "na");
    await storedMeeting(aa, feedMeeting({ ...heritage, sourceSlug: "heritage-aa" }), "2026-01-01T00:00:00Z");
    await storedMeeting(na, feedMeeting({ ...heritageNearby, sourceSlug: "heritage-na" }));
    await applyFeedSnapshot(na, [feedMeeting({ ...heritageNearby, sourceSlug: "heritage-na" })]);
    expect((await activeMeetings()).map((meeting) => meeting.fellowship).sort()).toEqual(["aa", "na"]);
  });

  it("splits a stored NA meeting into two NA meetings", async () => {
    const a = await seedFeed("na-a", "region", "na");
    const b = await seedFeed("na-b", "region", "na");
    const church = listing(
      "Gift of Desperation",
      "4001 Rossville Blvd, Chattanooga, TN 37407",
      34.9974,
      -85.2917,
    );
    const men = feedMeeting({ ...church, sourceSlug: "mens", types: ["M"] });
    const women = feedMeeting({ ...church, sourceSlug: "womens", name: "Women in Recovery", types: ["W"] });
    await storedMeetingWith([
      { feedId: a, row: men },
      { feedId: b, row: women },
    ]);
    await applyFeedSnapshot(a, [men]);
    expect((await activeMeetings()).map((meeting) => meeting.fellowship)).toEqual(["na", "na"]);
  });

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

  it("splits a stored men's and women's meeting at one address into two on the next sync", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const lansing = listing(
      "Little Red Book Study",
      "2909 W Genesee St, Lansing, MI 48917, USA",
      42.7432,
      -84.5917,
    );
    const men = feedMeeting({ ...lansing, sourceSlug: "little-red-book", types: ["M"] });
    const women = feedMeeting({ ...lansing, sourceSlug: "aa-meeting", name: "AA Meeting", types: ["W"] });
    const mixed = await storedMeetingWith([
      { feedId: a, row: men },
      { feedId: b, row: women },
    ]);
    await applyFeedSnapshot(a, [men]);
    expect(await typesByMeeting()).toEqual([["M"], ["W"]]);
    expect(await meetingIdOf(a, "little-red-book")).toBe(mixed);
  });

  it("splits a stored meeting of unrelated listings that share a placeholder Zoom URL", async () => {
    const [a, b, c] = [await seedFeed("a"), await seedFeed("b"), await seedFeed("c")];
    const junk = (sourceSlug: string, name: string) =>
      feedMeeting({ ...online, sourceSlug, name, conferenceUrl: "https://zoom.us/join" });
    await storedMeetingWith([
      { feedId: a, row: junk("a", "11th Step #2 Online") },
      { feedId: b, row: junk("b", "We Agnostics") },
      { feedId: c, row: junk("c", "Women's PTA") },
    ]);
    await applyFeedSnapshot(a, [junk("a", "11th Step #2 Online")]);
    expect(await activeMeetings()).toHaveLength(3);
  });

  it("keeps a stored meeting whose two feeds share a Zoom link written without a slash after /j", async () => {
    const [a, b] = [await seedFeed("a"), await seedFeed("b")];
    const zoom = (sourceSlug: string) =>
      feedMeeting({
        ...online,
        sourceSlug,
        name: "Acceptance is the Answer (online only)",
        conferenceUrl: "https://us02web.zoom.us/j8265745930",
      });
    const stored = await storedMeetingWith([
      { feedId: a, row: zoom("a") },
      { feedId: b, row: zoom("b") },
    ]);
    await applyFeedSnapshot(a, [zoom("a")]);
    expect(await sourcesOf(stored)).toEqual(["a", "b"]);
  });

  it("splits a stored meeting of two hybrid venues 2.8 km apart that share a Zoom meeting", async () => {
    const [a, b] = [await seedFeed("a"), await seedFeed("b")];
    const zoom = { attendance: "hybrid", conferenceUrl: "https://zoom.us/j/81234567890" } as const;
    const capitan = feedMeeting({
      ...zoom,
      sourceSlug: "capitan",
      ...listing("La Mesa del Capitan", "1 Main St, Washington, DC 20001, USA", 38.9, -77.03),
    });
    const fe = feedMeeting({
      ...zoom,
      sourceSlug: "fe",
      ...listing("Fe y Acción", "2 Main St, Washington, DC 20001, USA", northOf(38.9, 2800), -77.03),
    });
    await storedMeetingWith([
      { feedId: a, row: capitan },
      { feedId: b, row: fe },
    ]);
    await applyFeedSnapshot(a, [capitan]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("keeps a stored meeting whose three feeds share one Zoom meeting", async () => {
    const [a, b, c] = [await seedFeed("a"), await seedFeed("b"), await seedFeed("c")];
    const zoom = (sourceSlug: string) =>
      feedMeeting({ ...online, sourceSlug, conferenceUrl: "https://zoom.us/j/555" });
    await storedMeetingWith([
      { feedId: a, row: zoom("a") },
      { feedId: b, row: zoom("b") },
      { feedId: c, row: zoom("c") },
    ]);
    await applyFeedSnapshot(a, [zoom("a")]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("keeps a stored chain whose ends match only through the middle listing", async () => {
    const [a, b, c] = [await seedFeed("a"), await seedFeed("b"), await seedFeed("c")];
    const at = (sourceSlug: string, meters: number) =>
      feedMeeting({
        sourceSlug,
        ...listing(
          "Heritage",
          `${String(meters)} Gregorie Ferry Rd, Mt Pleasant, SC 29466, USA`,
          northOf(32.8468, meters),
          -79.8231,
        ),
      });
    await storedMeetingWith([
      { feedId: a, row: at("a", 0) },
      { feedId: b, row: at("b", 100) },
      { feedId: c, row: at("c", 200) },
    ]);
    await applyFeedSnapshot(c, [at("c", 200)]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("merges a listing split off a stored meeting into the meeting it matches", async () => {
    const [x, y, z] = [await seedFeed("x"), await seedFeed("y"), await seedFeed("z")];
    const oak = listing("Serenity Seekers", "5 Oak St, Nashville, TN 37203, USA", 36.2, -86.7);
    const existing = await storedMeeting(z, feedMeeting({ ...oak, sourceSlug: "z" }), "2026-01-01T00:00:00Z");
    const stray = feedMeeting({ ...oak, sourceSlug: "y" });
    const junk = await storedMeetingWith([
      { feedId: x, row: feedMeeting({ sourceSlug: "x" }) },
      { feedId: y, row: stray },
    ]);
    await applyFeedSnapshot(y, [stray]);
    expect(await sourcesOf(existing)).toEqual(["y", "z"]);
    expect(await sourcesOf(junk)).toEqual(["x"]);
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
