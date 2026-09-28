import { describe, expect, it } from "vitest";

import { entityId } from "../src/ids";

describe("entityId", () => {
  it("slugs the name and any qualifiers, joining them in order", () => {
    expect(entityId("AA Vermont District 11", "Chittenden County", "VT")).toBe(
      "aa-vermont-district-11-chittenden-county-vt",
    );
  });

  it("skips qualifiers with no text, e.g. a footer area's name alone", () => {
    expect(entityId("Area 070 - Vermont")).toBe("area-070-vermont");
  });
});
