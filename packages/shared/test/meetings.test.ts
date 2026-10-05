import { describe, expect, it } from "vitest";

import {
  isV1MeetingType,
  MeetingSearchRequest,
  MeetingSummary,
  NA_MEETING_TYPE_CODES,
  OnlineMeetingsQuery,
  V1MeetingSummary,
} from "../src/index";

const summary = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  name: "Nooners",
  day: 1,
  time: "12:00",
  endTime: null,
  timezone: "America/Chicago",
  types: ["O", "12x12"],
  attendance: "hybrid",
  locationName: "St. Luke's",
  formattedAddress: "1 Main St, Nashville, TN 37203, USA",
  latitude: 36.16,
  longitude: -86.78,
  locationNotes: null,
  notes: null,
  groupName: null,
  conferenceUrl: "https://zoom.us/j/123",
  conferenceUrlNotes: null,
  conferencePhone: null,
  conferencePhoneNotes: null,
  sourceUrl: null,
  tagsDisabled: false,
  tags: [{ slug: "laid-back", count: 14 }],
};

describe("MeetingSearchRequest", () => {
  it("accepts coordinates rounded to 2 decimal places", () => {
    expect(MeetingSearchRequest.parse({ lat: 36.16, lng: -86.78, radiusKm: 25 })).toEqual({
      lat: 36.16,
      lng: -86.78,
      radiusKm: 25,
    });
  });

  it.each([
    { lat: 36.162, lng: -86.78, radiusKm: 25 },
    { lat: 36.16, lng: -86.7812, radiusKm: 25 },
    { lat: 91, lng: 0, radiusKm: 25 },
    { lat: 36.16, lng: -86.78, radiusKm: 0 },
    { lat: 36.16, lng: -86.78, radiusKm: 101 },
    { lat: 36.16, lng: -86.78, radiusKm: 2.5 },
  ])("rejects %j", (request) => {
    expect(MeetingSearchRequest.safeParse(request).success).toBe(false);
  });
});

describe("V1MeetingSummary (builds before 1.1)", () => {
  it("accepts a well-formed meeting", () => {
    expect(V1MeetingSummary.parse(summary)).toEqual(summary);
  });

  it.each([
    { time: "7:00" },
    { day: 7 },
    { types: ["ONL"] },
    { attendance: "inactive" },
    { conferenceUrl: "javascript:alert(1)" },
  ])("rejects %j", (change) => {
    expect(V1MeetingSummary.safeParse({ ...summary, ...change }).success).toBe(false);
  });

  it.each([{ tags: [{ slug: "laid-back", count: 0 }] }, { tags: [{ slug: "Laid Back", count: 3 }] }])(
    "rejects tag counts that aren't a slug with a positive count: %j",
    (change) => {
      expect(V1MeetingSummary.safeParse({ ...summary, ...change }).success).toBe(false);
    },
  );
});

describe("the v1 types", () => {
  it("still refuses a type 1.0 has never heard of", () => {
    expect(V1MeetingSummary.safeParse({ ...summary, types: ["JFT"] }).success).toBe(false);
  });

  it("names exactly the v1 types", () => {
    expect(isV1MeetingType("O")).toBe(true);
    expect(isV1MeetingType("JFT")).toBe(false);
  });
});

describe("MeetingSummary (/api/v2)", () => {
  it("reads a type and a fellowship this build has never heard of", () => {
    expect(MeetingSummary.parse({ ...summary, types: ["XYZ"], fellowship: "al-anon" })).toMatchObject({
      types: ["XYZ"],
      fellowship: "al-anon",
    });
  });

  // A copy 1.0 saved has no fellowship, and every meeting 1.0 saw was AA's.
  it("reads a 1.0-era meeting, with no fellowship, as AA's", () => {
    expect(MeetingSummary.parse(summary).fellowship).toBe("aa");
  });

  it("lists NA's literature formats", () => {
    expect(NA_MEETING_TYPE_CODES).toEqual(["BT", "JFT", "IW", "SWG"]);
  });
});

describe("OnlineMeetingsQuery", () => {
  it("reads the day from a query string value", () => {
    expect(OnlineMeetingsQuery.parse({ day: "3" })).toEqual({ day: 3 });
  });

  it.each([null, "7", "-1", "x", "1.5"])("rejects day %j", (day) => {
    expect(OnlineMeetingsQuery.safeParse({ day }).success).toBe(false);
  });
});
