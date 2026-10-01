import { milesLabel, radiusMiles } from "@/meetings/units";
import { filtering, type MeetingFilters, NO_FILTERS } from "@/search/filters";
import { sortNearby } from "@/search/nearby";

import { meeting, nearbyMeeting } from "./fixtures";

// Once the person has chosen every group, as Clear filters does, the filters alone decide.
const matchesFilters = (summary: ReturnType<typeof meeting>, filters: MeetingFilters) =>
  filtering(filters, new Date("2026-10-05T17:30:00Z")).keeps(summary, new Date("2026-10-12T17:30:00Z"));

describe("filters the person has chosen", () => {
  const evening = meeting({
    day: 1,
    time: "19:00",
    types: ["O", "B"],
    tags: [{ slug: "welcoming", count: 3 }],
  });

  it("keeps everything with no filters", () => {
    expect(matchesFilters(evening, NO_FILTERS)).toBe(true);
  });

  it.each([
    [{ days: [1] }, true],
    [{ days: [2, 3] }, false],
    [{ times: ["evening"] }, true],
    [{ times: ["morning", "afternoon"] }, false],
    [{ types: ["O"] }, true],
    [{ types: ["O", "W"] }, false],
    [{ tags: ["welcoming"] }, true],
    [{ tags: ["welcoming", "quiet"] }, false],
  ] as const)("%j keeps it: %s", (change, kept) => {
    expect(matchesFilters(evening, { ...NO_FILTERS, ...change })).toBe(kept);
  });

  it("matches any chosen day or time, but every chosen type and tag", () => {
    expect(matchesFilters(evening, { ...NO_FILTERS, days: [0, 1], times: ["morning", "evening"] })).toBe(
      true,
    );
    expect(matchesFilters(evening, { ...NO_FILTERS, types: ["O", "B"], tags: ["welcoming"] })).toBe(true);
  });

  it("starts a time of day on its first minute and ends it before its last", () => {
    const evenings = { ...NO_FILTERS, times: ["evening" as const] };
    expect(matchesFilters(meeting({ time: "17:00" }), evenings)).toBe(true);
    expect(matchesFilters(meeting({ time: "16:59" }), evenings)).toBe(false);
    expect(matchesFilters(meeting({ time: "21:00" }), evenings)).toBe(false);
  });

  it("counts night as running past midnight", () => {
    expect(matchesFilters(meeting({ time: "23:30" }), { ...NO_FILTERS, times: ["night"] })).toBe(true);
    expect(matchesFilters(meeting({ time: "04:59" }), { ...NO_FILTERS, times: ["night"] })).toBe(true);
    expect(matchesFilters(meeting({ time: "05:00" }), { ...NO_FILTERS, times: ["night"] })).toBe(false);
    expect(matchesFilters(meeting({ time: "20:59" }), { ...NO_FILTERS, times: ["night"] })).toBe(false);
  });
});

describe("sortNearby", () => {
  const MARYVILLE = { latitude: 35.7565, longitude: -83.9705 };
  // Monday 12:30 PM in Chicago.
  const NOW = new Date("2026-10-05T17:30:00Z");
  const at = (id: string, time: string, latitude: number, longitude: number, distanceKm = 1) =>
    nearbyMeeting({
      id: `${id}1111111-1111-4111-8111-111111111111`,
      day: 1,
      time,
      latitude,
      longitude,
      distanceKm,
    });
  const near5pm = at("1", "17:00", 35.7566, -83.9706);
  const near1pm = at("2", "13:00", 35.7566, -83.9706);
  const far3pm = at("3", "15:00", 35.77, -83.99, 0.9);
  const far5pm = at("4", "17:00", 35.77, -83.99, 0.9);
  const near8pm = at("5", "20:00", 35.7566, -83.9706);
  // In the server's order, by the rounded point's distance: the far 5 PM before the near one.
  const all = [far5pm, near5pm, near8pm, far3pm, near1pm];
  const ids = (meetings: { id: string }[]) => meetings.map((m) => m.id.slice(0, 1));

  it("puts the soonest first, and the nearest first among meetings at the same time", () => {
    expect(ids(sortNearby(all, MARYVILLE, "soonest", NOW))).toEqual(["2", "3", "1", "4", "5"]);
  });

  it("puts the nearest first by exact distance, and the soonest first at the same place", () => {
    const sorted = sortNearby(all, MARYVILLE, "nearest", NOW);
    expect(ids(sorted)).toEqual(["2", "1", "5", "3", "4"]);
    expect(sorted[3]?.exactKm).toBeCloseTo(2.31, 2);
  });

  // Nearby meetings are almost always in the phone's own zone, so it's the best guess for one the feed gave none.
  it("reads the listed time of a meeting without a time zone on the phone's clock", () => {
    const zoneless2pm = { ...at("6", "14:00", 35.7566, -83.9706), timezone: null };
    expect(ids(sortNearby([...all, zoneless2pm], MARYVILLE, "soonest", NOW))).toEqual([
      "2",
      "6",
      "3",
      "1",
      "4",
      "5",
    ]);
  });

  it("keeps the server's distance for a meeting without coordinates", () => {
    const unplaced = nearbyMeeting({ latitude: null, longitude: null, distanceKm: 3.2 });
    expect(sortNearby([unplaced], MARYVILLE, "nearest", NOW)[0]?.exactKm).toBe(3.2);
  });
});

describe("milesLabel", () => {
  it.each([
    [0.0143, "under 0.1 mi"],
    [2.3128, "1.4 mi"],
    [15.9, "9.9 mi"],
    [20, "12 mi"],
  ])("%d km reads %s", (km, label) => {
    expect(milesLabel(km)).toBe(label);
  });
});

describe("radiusMiles", () => {
  it("gives a search radius in whole miles", () => {
    expect(radiusMiles(25)).toBe(16);
  });
});
