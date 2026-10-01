import { describe, expect, it } from "vitest";

import { CATCH_UP_MINUTES, cdnStaleMinutes, VOCABULARY_CATCH_UP_HOURS } from "../src/index";

describe("cdnStaleMinutes", () => {
  it("is how long the CDN can go on serving a copy: s-maxage plus stale-while-revalidate", () => {
    expect(cdnStaleMinutes("meetingDetail")).toBe(15);
    expect(cdnStaleMinutes("onlineMeetings")).toBe(75);
    expect(cdnStaleMinutes("vocabulary")).toBe(1500);
  });
});

describe("the catch-up promises", () => {
  it("are the slowest meeting response, plus a sync for a feed opt-out", () => {
    expect(CATCH_UP_MINUTES).toEqual({ app: 75, feedOptOut: 90 });
  });

  it("give the tag list a day and an hour", () => {
    expect(VOCABULARY_CATCH_UP_HOURS).toBe(25);
  });
});
