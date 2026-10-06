import type { V1MeetingSummary } from "@mymeetingapp/shared";

import { whyNoNewTags } from "@/tagging/window";

import { meeting as listed } from "./fixtures";

// Nooners: Mondays 12:00–1:00 PM in Chicago. Monday 5 October 2026 at noon is 17:00 UTC.
const NOONERS = { day: 1, time: "12:00", endTime: "13:00", timezone: "America/Chicago" };

// Whether the phone offers a new tagging at `at`, with tagging on, the app current and no record on this phone.
const taggingOpen = (meeting: Partial<V1MeetingSummary>, at: Date) =>
  whyNoNewTags(listed(meeting), null, at, true, false) === null;

// Whether a record confirmed at `confirmedAt` stops a new tagging at `at`, on a meeting whose window is open then
// (Mondays at 10 AM in Chicago, so from 15:00 UTC on Monday 5 and 12 October 2026).
const confirmedThisWeek = (confirmedAt: Date, at: Date) =>
  whyNoNewTags(
    listed({ day: 1, time: "10:00", endTime: null, timezone: "America/Chicago" }),
    { meetingId: "m", name: "Ten O'Clock", tags: [], confirmedAt, updatedAt: confirmedAt },
    at,
    true,
    false,
  ) === "";

describe("the tagging window (spec §5, as the server's taggingWindowOpen)", () => {
  it.each([
    ["a minute before the start", "2026-10-05T16:59:00Z", false],
    ["at the start", "2026-10-05T17:00:00Z", true],
    ["35 hours 59 minutes after", "2026-10-07T04:59:00Z", true],
    ["36 hours after", "2026-10-07T05:00:00Z", false],
  ])("%s", (_when, at, open) => {
    expect(taggingOpen(NOONERS, new Date(at))).toBe(open);
  });

  // 1 November 2026, New York: 1:30 AM happens at 05:30 UTC (EDT) and again at 06:30 UTC (EST). Postgres's AT TIME
  // ZONE, and so the server, takes the later one.
  it("opens at the later 1:30 AM on the night the clocks fall back", () => {
    const meeting = { day: 0, time: "01:30", endTime: null, timezone: "America/New_York" };
    expect(taggingOpen(meeting, new Date("2026-11-01T05:45:00Z"))).toBe(false);
    expect(taggingOpen(meeting, new Date("2026-11-01T06:30:00Z"))).toBe(true);
  });

  // 8 March 2026, New York: 2:30 AM never happens; the server moves it an hour later, to 3:30 AM EDT (07:30 UTC).
  it("opens an hour later for a time the clocks skip", () => {
    const meeting = { day: 0, time: "02:30", endTime: null, timezone: "America/New_York" };
    expect(taggingOpen(meeting, new Date("2026-03-08T07:29:00Z"))).toBe(false);
    expect(taggingOpen(meeting, new Date("2026-03-08T07:30:00Z"))).toBe(true);
  });

  it("follows the meeting's own zone, not the phone's", () => {
    const tokyo = { day: 1, time: "19:00", endTime: null, timezone: "Asia/Tokyo" };
    // Monday 7 PM in Tokyo is Monday 10:00 UTC, while the phone (Chicago) still reads Monday 5 AM.
    expect(taggingOpen(tokyo, new Date("2026-10-05T09:59:00Z"))).toBe(false);
    expect(taggingOpen(tokyo, new Date("2026-10-05T10:00:00Z"))).toBe(true);
  });
});

describe("one tagging a week (spec §5's 7-day rule, as the server's)", () => {
  it.each([
    ["6 days 23 hours later", "2026-10-12T16:00:00Z", true],
    ["exactly 7 days later", "2026-10-12T17:00:00Z", false],
  ])("%s", (_when, at, within) => {
    expect(confirmedThisWeek(new Date("2026-10-05T17:00:00Z"), new Date(at))).toBe(within);
  });

  // A record stamped later than now was made before the phone's clock moved back; it mustn't hide tagging for a week
  // and more.
  it("is false for a record stamped in the future", () => {
    expect(confirmedThisWeek(new Date("2026-10-05T17:00:00Z"), new Date("2026-10-05T16:00:00Z"))).toBe(false);
  });
});
