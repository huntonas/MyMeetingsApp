import { onlineNow } from "@/meetings/online-now";
import {
  lastOccurrence,
  listedTime,
  nextStart,
  occurrenceEnd,
  type Scheduled,
  shortWhen,
  yourTime,
} from "@/meetings/schedule";

import { meeting } from "./fixtures";

// 2026-10-05 is a Monday. The US clocks change on 2026-03-08 and 2026-11-01, the UK's on 2026-03-29 and 2026-10-25,
// Adelaide's and Chatham's on 2026-04-05 and in late September or early October. Every expected instant with a clock
// change was checked against Postgres (`'2026-04-05 02:30'::timestamp at time zone 'Australia/Adelaide'`).
const chicagoMonday7pm = { day: 1, time: "19:00", endTime: null, timezone: "America/Chicago" };
const iso = (date: Date) => date.toISOString();
const next = (scheduled: Scheduled, now: Date) => nextStart(scheduled, lastOccurrence(scheduled, now));

describe("occurrences in the meeting's own zone", () => {
  it("finds the latest start at or before now, and the next one", () => {
    const now = new Date("2026-10-05T23:30:00Z"); // Monday 6:30 PM in Chicago
    expect(iso(lastOccurrence(chicagoMonday7pm, now).start)).toBe("2026-09-29T00:00:00.000Z");
    expect(iso(next(chicagoMonday7pm, now))).toBe("2026-10-06T00:00:00.000Z");
  });

  it("counts a start at exactly now as the latest one", () => {
    const now = new Date("2026-10-06T00:00:00Z"); // Monday 7:00 PM in Chicago
    expect(iso(lastOccurrence(chicagoMonday7pm, now).start)).toBe("2026-10-06T00:00:00.000Z");
    expect(iso(next(chicagoMonday7pm, now))).toBe("2026-10-13T00:00:00.000Z");
  });

  it("looks back to last week for a weekday later in the week", () => {
    const wednesday = { ...chicagoMonday7pm, day: 3 };
    const now = new Date("2026-10-05T23:30:00Z");
    expect(iso(lastOccurrence(wednesday, now).start)).toBe("2026-10-01T00:00:00.000Z");
    expect(iso(next(wednesday, now))).toBe("2026-10-08T00:00:00.000Z");
  });

  it("uses the date in the meeting's zone, not the phone's", () => {
    // 12:30 AM Monday in New York is still Sunday 11:30 PM on the phone (Chicago).
    const newYorkMonday = { day: 1, time: "00:15", endTime: null, timezone: "America/New_York" };
    const now = new Date("2026-10-05T04:30:00Z");
    expect(iso(lastOccurrence(newYorkMonday, now).start)).toBe("2026-10-05T04:15:00.000Z");
  });

  it("keeps the meeting's local time across a daylight-saving change", () => {
    const now = new Date("2026-10-31T12:00:00Z"); // the Saturday before clocks fall back
    expect(iso(lastOccurrence(chicagoMonday7pm, now).start)).toBe("2026-10-27T00:00:00.000Z");
    expect(iso(next(chicagoMonday7pm, now))).toBe("2026-11-03T01:00:00.000Z");
  });

  // Owner ruling M-a: the later instant, as Postgres's AT TIME ZONE resolves it on the server.
  it.each([
    ["America/New_York", "01:30", "2026-10-31T12:00:00Z", "2026-11-01T06:30:00.000Z"],
    ["Europe/London", "01:30", "2026-10-24T12:00:00Z", "2026-10-25T01:30:00.000Z"],
    ["Australia/Adelaide", "02:30", "2026-04-03T12:00:00Z", "2026-04-04T17:00:00.000Z"],
    ["Pacific/Chatham", "03:30", "2026-04-03T12:00:00Z", "2026-04-04T14:45:00.000Z"],
  ])(
    "in %s, takes the later instant for %s, a time that happens twice when clocks fall back",
    (zone, time, now, start) => {
      expect(iso(next({ day: 0, time, endTime: null, timezone: zone }, new Date(now)))).toBe(start);
    },
  );

  it("moves a time the clocks skip an hour later, as the server does", () => {
    const meetingAt = { day: 0, time: "02:30", endTime: null, timezone: "America/New_York" };
    expect(iso(next(meetingAt, new Date("2026-03-07T12:00:00Z")))).toBe("2026-03-08T07:30:00.000Z");
  });

  it.each([
    ["Europe/London", "01:30", "2026-03-28T12:00:00Z", "2026-03-29T01:30:00.000Z"],
    ["Australia/Adelaide", "02:30", "2026-10-02T12:00:00Z", "2026-10-03T17:00:00.000Z"],
    ["Pacific/Chatham", "03:10", "2026-09-25T12:00:00Z", "2026-09-26T14:25:00.000Z"],
  ])("in %s, moves %s, a time the clocks skip, later by the jump", (zone, time, now, start) => {
    expect(iso(next({ day: 0, time, endTime: null, timezone: zone }, new Date(now)))).toBe(start);
  });

  it("places a half-hour zone with no clock changes", () => {
    const kolkata = { day: 1, time: "19:00", endTime: null, timezone: "Asia/Kolkata" };
    expect(iso(next(kolkata, new Date("2026-10-04T12:00:00Z")))).toBe("2026-10-05T13:30:00.000Z");
  });

  it("ends a meeting on the next day when its end time is earlier than its start", () => {
    const lateNight = { day: 0, time: "23:30", endTime: "00:30", timezone: "America/Los_Angeles" };
    const occurrence = lastOccurrence(lateNight, new Date("2026-10-05T07:00:00Z"));
    expect(iso(occurrenceEnd(lateNight, occurrence))).toBe("2026-10-05T07:30:00.000Z");
  });

  it("ends a meeting on the same day when its end time is later than its start", () => {
    const evening = { day: 1, time: "18:00", endTime: "19:15", timezone: "America/Chicago" };
    const occurrence = lastOccurrence(evening, new Date("2026-10-05T23:30:00Z"));
    expect(iso(occurrenceEnd(evening, occurrence))).toBe("2026-10-06T00:15:00.000Z");
  });

  it("treats an end time equal to the start as no end time, an hour long", () => {
    const sameTimes = { day: 1, time: "18:00", endTime: "18:00", timezone: "America/Chicago" };
    const occurrence = lastOccurrence(sameTimes, new Date("2026-10-05T23:30:00Z"));
    expect(iso(occurrenceEnd(sameTimes, occurrence))).toBe("2026-10-06T00:00:00.000Z");
  });

  it.each([
    ["00:00", "12:00 AM"],
    ["07:05", "7:05 AM"],
    ["12:30", "12:30 PM"],
    ["19:00", "7:00 PM"],
  ])("lists %s as %s", (time, label) => {
    expect(listedTime(time)).toBe(label);
  });

  it.each([
    [0, "07:05", "Sun 7:05 AM"],
    [1, "19:00", "Mon 7:00 PM"],
    [6, "00:00", "Sat 12:00 AM"],
  ])("lists day %d at %s as %s on a card", (day, time, label) => {
    expect(shortWhen({ day, time })).toBe(label);
  });
});

describe("yourTime", () => {
  // The phone runs in Chicago (the test script sets TZ). 2026-10-05 is a Monday and 2026-10-20 a Tuesday.
  it.each([
    ["an hour ahead", "America/New_York", 1, "19:30", "2026-10-05T12:00:00Z", "Monday at 6:30 PM"],
    [
      "on the phone's previous day",
      "America/New_York",
      2,
      "00:30",
      "2026-10-05T12:00:00Z",
      "Monday at 11:30 PM",
    ],
    // By the next Monday the UK has fallen back and the US hasn't, so the gap is 5 hours, not today's 6.
    [
      "after only one zone has changed its clocks",
      "Europe/London",
      1,
      "19:00",
      "2026-10-20T12:00:00Z",
      "Monday at 2:00 PM",
    ],
  ])("says when a meeting %s is on the phone's clock", (_case, timezone, day, time, now, said) => {
    expect(yourTime({ day, time, endTime: null, timezone }, new Date(now))).toBe(`That's ${said} your time.`);
  });

  it("says nothing when the phone keeps the meeting's time", () => {
    const central = { day: 1, time: "19:30", endTime: null, timezone: "America/Chicago" };
    expect(yourTime(central, new Date("2026-10-05T12:00:00Z"))).toBeNull();
  });
});

describe("onlineNow", () => {
  const online = (change: Parameters<typeof meeting>[0]) =>
    meeting({ attendance: "online", conferenceUrl: "https://zoom.us/j/1", ...change });
  const names = (list: { meeting: { name: string } }[]) => list.map((timed) => timed.meeting.name);

  it("counts a meeting that crosses midnight as happening after midnight", () => {
    const lateNight = online({ day: 0, time: "23:30", endTime: "00:30", timezone: "America/Los_Angeles" });
    const { happening } = onlineNow([lateNight], new Date("2026-10-05T07:15:00Z"));
    expect(happening.map((timed) => iso(timed.start))).toEqual(["2026-10-05T06:30:00.000Z"]);
    expect(onlineNow([lateNight], new Date("2026-10-05T07:31:00Z")).happening).toHaveLength(0);
  });

  it("gives a meeting with no end time an hour", () => {
    const noon = online({ day: 1, time: "12:00", endTime: null });
    expect(onlineNow([noon], new Date("2026-10-05T17:59:00Z")).happening).toHaveLength(1);
    expect(onlineNow([noon], new Date("2026-10-05T18:00:00Z")).happening).toHaveLength(0);
  });

  it("counts a meeting starting at exactly now as happening, with its start", () => {
    const six = online({ day: 1, time: "18:00", endTime: "19:00" });
    const { happening, soon } = onlineNow([six], new Date("2026-10-05T23:00:00Z"));
    expect(happening.map((timed) => iso(timed.start))).toEqual(["2026-10-05T23:00:00.000Z"]);
    expect(soon).toEqual([]);
  });

  it("lists meetings starting within two hours as soon, with their start", () => {
    const eight = online({ day: 1, time: "20:00", endTime: null });
    expect(
      onlineNow([eight], new Date("2026-10-05T23:00:00Z")).soon.map((timed) => iso(timed.start)),
    ).toEqual(["2026-10-06T01:00:00.000Z"]);
    expect(onlineNow([eight], new Date("2026-10-05T22:59:00Z")).soon).toHaveLength(0);
  });

  it("lists a meeting on the next day in its own zone as soon", () => {
    const pastMidnight = online({ day: 2, time: "00:30", endTime: null });
    const { happening, soon } = onlineNow([pastMidnight], new Date("2026-10-06T04:30:00Z"));
    expect(happening).toEqual([]);
    expect(names(soon)).toEqual(["Nooners"]);
  });

  it("orders each list by start time, then by name", () => {
    const meetings = [
      online({ name: "Alpha", day: 1, time: "18:30", endTime: "20:00" }),
      online({ name: "Charlie", day: 1, time: "18:00", endTime: "20:00" }),
      online({ name: "Beta", day: 1, time: "18:00", endTime: "20:00" }),
      online({ name: "Last soon", day: 1, time: "21:00", endTime: null }),
      online({ name: "First soon", day: 1, time: "20:00", endTime: null }),
    ];
    const { happening, soon } = onlineNow(meetings, new Date("2026-10-06T00:00:00Z"));
    expect(names(happening)).toEqual(["Beta", "Charlie", "Alpha"]);
    expect(names(soon)).toEqual(["First soon", "Last soon"]);
  });

  it("leaves out a meeting with no time zone", () => {
    const unknown = online({ day: 1, time: "18:00", timezone: null });
    expect(onlineNow([unknown], new Date("2026-10-05T23:30:00Z"))).toEqual({ happening: [], soon: [] });
  });
});
