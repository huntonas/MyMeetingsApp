import { describe, expect, it } from "vitest";

import { MeetingSearchRequest, MeetingSummary, OnlineMeetingsQuery } from "../src/index";

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

describe("MeetingSummary", () => {
  it("accepts a well-formed meeting", () => {
    expect(MeetingSummary.parse(summary)).toEqual(summary);
  });

  it.each([
    { time: "7:00" },
    { day: 7 },
    { types: ["ONL"] },
    { attendance: "inactive" },
    { conferenceUrl: "javascript:alert(1)" },
  ])("rejects %j", (change) => {
    expect(MeetingSummary.safeParse({ ...summary, ...change }).success).toBe(false);
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
