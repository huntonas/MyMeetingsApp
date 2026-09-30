import { milesLabel, radiusMiles } from "@/meetings/units";
import { matchesFilters, NO_FILTERS } from "@/search/filters";
import { byExactDistance } from "@/search/nearby";

import { meeting, nearbyMeeting } from "./fixtures";

describe("matchesFilters", () => {
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

describe("byExactDistance", () => {
  it("re-sorts the server's order by the exact distance from the real point", () => {
    const far = nearbyMeeting({
      id: "11111111-1111-4111-8111-111111111111",
      latitude: 35.77,
      longitude: -83.99,
      distanceKm: 0.9,
    });
    const near = nearbyMeeting({
      id: "22222222-2222-4222-8222-222222222222",
      latitude: 35.7566,
      longitude: -83.9706,
      distanceKm: 1.6,
    });
    const sorted = byExactDistance([far, near], { latitude: 35.7565, longitude: -83.9705 });
    expect(sorted.map((m) => m.id)).toEqual([near.id, far.id]);
    expect(sorted[1]?.exactKm).toBeCloseTo(2.31, 2);
  });

  it("keeps the server's distance for a meeting without coordinates", () => {
    const unplaced = nearbyMeeting({ latitude: null, longitude: null, distanceKm: 3.2 });
    expect(byExactDistance([unplaced], { latitude: 35.7565, longitude: -83.9705 })[0]?.exactKm).toBe(3.2);
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
