import { describe, expect, it } from "vitest";

import { SemVer } from "../src/index";

describe("SemVer", () => {
  it.each(["0.0.0", "1.2.3", "10.20.30"])("accepts %s", (version) => {
    expect(SemVer.safeParse(version).success).toBe(true);
  });

  it.each(["1.2", "v1.2.3", "1.2.3-beta", " 1.2.3", "1.2.3.4", ""])("rejects %j", (version) => {
    expect(SemVer.safeParse(version).success).toBe(false);
  });
});
