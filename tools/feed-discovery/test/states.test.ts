import { describe, expect, it } from "vitest";

import { US_STATES } from "../src/states";

describe("US_STATES", () => {
  it("lists the 50 states plus DC, PR, GU, VI, AS and MP", () => {
    expect(US_STATES).toHaveLength(56);
    expect(US_STATES[0]).toEqual({ code: "AL", name: "Alabama" });
    expect(US_STATES.at(-1)).toEqual({ code: "MP", name: "Northern Mariana Islands" });
  });

  it("excludes aa.org's military state codes", () => {
    expect(US_STATES.some((state) => state.code === "AA")).toBe(false);
    expect(US_STATES.some((state) => state.code === "AE")).toBe(false);
    expect(US_STATES.some((state) => state.code === "AP")).toBe(false);
  });
});
