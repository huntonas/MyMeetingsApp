import { describe, expect, it } from "vitest";

import { isOlderVersion, SemVer } from "../src/index";

describe("SemVer", () => {
  it.each(["0.0.0", "1.2.3", "10.20.30"])("accepts %s", (version) => {
    expect(SemVer.safeParse(version).success).toBe(true);
  });

  it.each(["1.2", "v1.2.3", "1.2.3-beta", " 1.2.3", "1.2.3.4", ""])("rejects %j", (version) => {
    expect(SemVer.safeParse(version).success).toBe(false);
  });
});

describe("isOlderVersion", () => {
  it.each([
    ["1.2.3", "1.2.4", true],
    ["1.2.3", "1.3.0", true],
    ["0.9.9", "1.0.0", true],
    ["1.2.3", "1.2.3", false],
    ["1.10.0", "1.9.9", false],
    ["2.0.0", "1.99.99", false],
  ])("%s below %s is %s", (version, minimum, older) => {
    expect(isOlderVersion(version, minimum)).toBe(older);
  });
});
