import { describe, expect, it } from "vitest";

import { verifyFeed } from "../src/verify";

const meeting = {
  slug: "a",
  name: "A",
  day: 1,
  time: "19:00",
  formatted_address: "1 Main St, Nashville, TN 37203, USA",
};

describe("verifyFeed", () => {
  it("verifies a meeting array and summarizes it", () => {
    const result = verifyFeed([
      meeting,
      { ...meeting, slug: "b", state: "KY", formatted_address: undefined },
      { slug: "c", name: "By appointment" },
    ]);
    expect(result).toMatchObject({ verified: true, meetingCount: 3, statesCovered: ["KY", "TN"] });
    expect([...result.meetingKeys]).toEqual(["1|19:00|1 main st nashville tn 37203"]);
  });

  it.each([[], {}, null, "[]", [{ slug: "a", name: "A" }], [{ title: "x" }]])(
    "does not verify %j",
    (body) => {
      expect(verifyFeed(body).verified).toBe(false);
    },
  );

  it("ignores non-US state codes and malformed addresses", () => {
    expect(verifyFeed([{ ...meeting, state: "ON", formatted_address: "Toronto" }]).statesCovered).toEqual([]);
  });
});
