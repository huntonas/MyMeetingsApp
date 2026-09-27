import { describe, expect, it } from "vitest";

import { FeedFormatError, normalizeFeed } from "@/server/feeds/normalize";

const tsmlInPerson = {
  id: 4887,
  name: "10 AND 11",
  slug: "10-and-11",
  notes: "Mo-Su",
  updated: "2026-03-25 16:15:24",
  url: "https://aasandiego.org/meetings/10-and-11/",
  day: 1,
  time: "05:00",
  types: ["11", "C", "EN"],
  location: "Club",
  formatted_address: "6901 Central Ave, Lemon Grove, CA 91945, USA",
  approximate: "no",
  latitude: 32.7384959,
  longitude: -117.0491894,
  timezone: "America/Los_Angeles",
  group: "3245",
  attendance_option: "in_person",
  entity: "Alcoholics Anonymous San Diego",
  entity_url: "https://aasandiego.org",
  feedback_emails: ["office@example.org"],
  contact_1_name: "Pat",
  contact_1_email: "pat@example.org",
  contact_1_phone: "555-0100",
  email: "group@example.org",
  phone: "555-0101",
  venmo: "@group",
};

const tsmlOnline = {
  name: "STEPS 10 & 11 @ 5AM ONLINE",
  slug: "steps-online",
  day: 1,
  time: "05:00",
  types: ["C", "D", "ONL"],
  conference_url: "https://zoom.us/j/1",
  approximate: "yes",
  formatted_address: "San Diego, CA, USA",
};

describe("normalizeFeed", () => {
  it("keeps only allowlisted fields of an in-person meeting", () => {
    const { meetings, skipped } = normalizeFeed([tsmlInPerson]);
    expect(skipped).toBe(0);
    expect(meetings).toEqual([
      {
        sourceSlug: "10-and-11",
        day: 1,
        time: "05:00",
        endTime: null,
        timezone: "America/Los_Angeles",
        name: "10 AND 11",
        types: ["11", "C", "EN"],
        attendance: "in_person",
        locationName: "Club",
        formattedAddress: "6901 Central Ave, Lemon Grove, CA 91945, USA",
        addressKey: "6901 central ave lemon grove ca 91945",
        latitude: 32.7384959,
        longitude: -117.0491894,
        locationNotes: null,
        notes: "Mo-Su",
        groupName: "3245",
        conferenceUrl: null,
        conferenceUrlNotes: null,
        conferencePhone: null,
        conferencePhoneNotes: null,
        sourceUrl: "https://aasandiego.org/meetings/10-and-11/",
      },
    ]);
    expect(JSON.stringify(meetings)).not.toMatch(/pat@example|555-01|@group|office@example|group@example/);
  });

  it("treats an approximate location with a conference link as online, dropping the approximate address", () => {
    const [meeting] = normalizeFeed([tsmlOnline]).meetings;
    expect(meeting).toMatchObject({
      attendance: "online",
      formattedAddress: null,
      addressKey: null,
      latitude: null,
      longitude: null,
      types: ["C", "D"],
      conferenceUrl: "https://zoom.us/j/1",
    });
  });

  it("marks an in-person meeting with a conference link as hybrid", () => {
    const [meeting] = normalizeFeed([{ ...tsmlInPerson, conference_phone: "+1 555 0100,,123#" }]).meetings;
    expect(meeting?.attendance).toBe("hybrid");
  });

  it("treats a temporarily closed location with no link as inactive and skips it", () => {
    expect(normalizeFeed([{ ...tsmlInPerson, types: ["C", "TC"] }])).toEqual({ meetings: [], skipped: 1 });
  });

  it("expands a meeting listed on several days into one row per day", () => {
    const days = normalizeFeed([{ ...tsmlInPerson, day: [1, "3", "Friday"] }]).meetings.map((m) => m.day);
    expect(days).toEqual([1, 3, 5]);
  });

  it("reads Google Sheets style coordinates and normalizes times", () => {
    const sheetRow = {
      slug: 7,
      name: "Women's Book Study",
      day: "2",
      time: "5:00",
      end_time: "18:00:00",
      formatted_address: "1200 Blossom Hill Rd, San Jose, CA 95118, USA",
      coordinates: "37.24887,-121.87943",
    };
    expect(normalizeFeed([sheetRow]).meetings[0]).toMatchObject({
      sourceSlug: "7",
      day: 2,
      time: "05:00",
      endTime: "18:00",
      latitude: 37.24887,
      longitude: -121.87943,
    });
  });

  it("builds an address from separate fields", () => {
    const row = {
      slug: "a",
      name: "A",
      day: 0,
      time: "19:00",
      address: "1 Main St",
      city: "Nashville",
      state: "TN",
      postal_code: "37203",
      country: "US",
    };
    expect(normalizeFeed([row]).meetings[0]?.formattedAddress).toBe("1 Main St, Nashville, TN 37203, US");
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "/relative/path", "ftp://x.org/a"])(
    "never keeps the unsafe URL %j",
    (url) => {
      const [meeting] = normalizeFeed([{ ...tsmlInPerson, url, conference_url: url }]).meetings;
      expect(meeting?.sourceUrl).toBeNull();
      expect(meeting?.conferenceUrl).toBeNull();
    },
  );

  it("drops unknown type codes, matches codes case-insensitively and keeps the official spelling", () => {
    expect(
      normalizeFeed([{ ...tsmlInPerson, types: ["o", "12X12", "ZZZ", "onl"] }]).meetings[0]?.types,
    ).toEqual(["O", "12x12"]);
  });

  it("drops an invalid time zone and impossible coordinates", () => {
    const [meeting] = normalizeFeed([
      { ...tsmlInPerson, timezone: "Mars/Olympus", latitude: 0, longitude: 0 },
    ]).meetings;
    expect(meeting).toMatchObject({
      timezone: null,
      latitude: null,
      longitude: null,
      attendance: "in_person",
    });
  });

  it.each([
    { ...tsmlInPerson, day: undefined },
    { ...tsmlInPerson, time: "noon" },
    { ...tsmlInPerson, time: "24:00" },
    { ...tsmlInPerson, slug: "" },
    { ...tsmlInPerson, name: "   " },
    "not an object",
    null,
  ])("skips %j", (row) => {
    expect(normalizeFeed([row])).toEqual({ meetings: [], skipped: 1 });
  });

  it("keeps the first row when a feed repeats a slug on the same day", () => {
    const { meetings } = normalizeFeed([tsmlInPerson, { ...tsmlInPerson, name: "Duplicate" }]);
    expect(meetings.map((m) => m.name)).toEqual(["10 AND 11"]);
  });

  it.each([{ meetings: [] }, "[]", null])("rejects %j as not a feed", (json) => {
    expect(() => normalizeFeed(json)).toThrow(FeedFormatError);
  });
});
