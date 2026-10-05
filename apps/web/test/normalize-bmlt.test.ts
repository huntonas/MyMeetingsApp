import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { FeedFormatError } from "@/server/feeds/normalize";
import { normalizeBmlt } from "@/server/feeds/normalize-bmlt";

const FEED = "https://natennessee.org/main_server/client_interface/json/?switcher=GetSearchResults";

// A real answer from Tennessee's server, trimmed to three meetings and the formats they and these tests use.
const Rows = z.array(z.record(z.string(), z.string()));
const fixture = z
  .object({ meetings: Rows, formats: Rows })
  .parse(JSON.parse(readFileSync(path.resolve(import.meta.dirname, "fixtures/bmlt-tennessee.json"), "utf8")));
const recovery = fixture.meetings.find((row) => row.id_bigint === "1525");
if (recovery === undefined) throw new Error("the fixture lost meeting 1525");

const withRows = (...rows: Record<string, string>[]) => ({ meetings: rows, formats: fixture.formats });

describe("normalizeBmlt", () => {
  it("reads a real in-person meeting from Tennessee's server", () => {
    expect(normalizeBmlt(withRows(recovery), FEED).meetings).toEqual([
      {
        sourceSlug: "1525",
        day: 0,
        time: "09:00",
        endTime: "10:00",
        timezone: null,
        name: "Recovery Is Possible",
        types: ["C", "O", "D", "LIT", "X"],
        attendance: "in_person",
        locationName: "Temple Baptist Church",
        formattedAddress: "34 Oak Tree Drive, McMinnville, TN 37110",
        addressKey: "34 oak tree dr mcminnville tn 37110",
        latitude: 35.7064197,
        longitude: -85.8471107,
        locationNotes: "(Meeting meets in the basement)",
        notes: null,
        groupName: null,
        conferenceUrl: null,
        conferenceUrlNotes: null,
        conferencePhone: null,
        conferencePhoneNotes: null,
        sourceUrl: null,
      },
    ]);
  });

  it("maps NA's formats by world_id, whatever letters the server uses, and drops the rest", () => {
    const row = { ...recovery, formats: "BT,JT,SG,VM,SP,ZZ" };
    expect(normalizeBmlt(withRows(row), FEED).meetings[0]?.types).toEqual(["BT", "JFT", "SWG"]);
  });

  // Review Focus 2.
  it("ends a meeting that runs past midnight the next morning", () => {
    const late = { ...recovery, start_time: "23:30:00", duration_time: "01:00:00" };
    expect(normalizeBmlt(withRows(late), FEED).meetings[0]).toMatchObject({
      time: "23:30",
      endTime: "00:30",
    });
  });

  it("keeps no address or pin for a virtual meeting, and needs its link", () => {
    const virtual = { ...recovery, venue_type: "2", virtual_meeting_link: "https://zoom.us/j/123456789" };
    expect(normalizeBmlt(withRows(virtual), FEED).meetings[0]).toMatchObject({
      attendance: "online",
      formattedAddress: null,
      latitude: null,
      longitude: null,
      conferenceUrl: "https://zoom.us/j/123456789",
    });
    expect(normalizeBmlt(withRows({ ...virtual, virtual_meeting_link: "" }), FEED)).toEqual({
      meetings: [],
      skipped: 1,
    });
  });

  it("reads a hybrid meeting as hybrid, and one with no link as in person", () => {
    const hybrid = { ...recovery, venue_type: "3", virtual_meeting_link: "https://zoom.us/j/987654321" };
    expect(normalizeBmlt(withRows(hybrid), FEED).meetings[0]?.attendance).toBe("hybrid");
    expect(
      normalizeBmlt(withRows({ ...hybrid, virtual_meeting_link: "" }), FEED).meetings[0]?.attendance,
    ).toBe("in_person");
  });

  it("never reads an in-person meeting's stray link as a way to join it", () => {
    const stray = { ...recovery, virtual_meeting_link: "https://zoom.us/j/111" };
    expect(normalizeBmlt(withRows(stray), FEED).meetings[0]).toMatchObject({
      attendance: "in_person",
      conferenceUrl: null,
    });
  });

  it("treats a temporarily closed venue as not in person", () => {
    expect(normalizeBmlt(withRows({ ...recovery, formats: "O,TC" }), FEED).meetings).toEqual([]);
  });

  // Review Focus 1.
  it("applies only this server's own meetings, with or without a trailing slash", () => {
    const own = { ...recovery, root_server_uri: "https://natennessee.org/main_server/" };
    const other = {
      ...recovery,
      id_bigint: "77",
      root_server_uri: "https://texasoklahomana.org/main_server/",
    };
    expect(normalizeBmlt(withRows(own, other), FEED).meetings.map((meeting) => meeting.sourceSlug)).toEqual([
      "1525",
    ]);
  });

  it("skips a row with no usable day or time", () => {
    expect(normalizeBmlt(withRows({ ...recovery, weekday_tinyint: "8" }), FEED)).toEqual({
      meetings: [],
      skipped: 1,
    });
    expect(normalizeBmlt(withRows({ ...recovery, start_time: "" }), FEED).skipped).toBe(1);
  });

  it.each([[[]], [{}], [{ meetings: "x", formats: [] }], [null]])(
    "rejects %j as not a BMLT answer",
    (body) => {
      expect(() => normalizeBmlt(body, FEED)).toThrow(FeedFormatError);
    },
  );
});
