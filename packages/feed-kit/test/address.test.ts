import { describe, expect, it } from "vitest";

import { addressKey } from "../src/index";

describe("addressKey", () => {
  it.each([
    ["6901 Central Ave, Lemon Grove, CA 91945, USA", "6901 central ave lemon grove ca 91945"],
    ["6901 Central Avenue, Lemon Grove, CA 91945", "6901 central ave lemon grove ca 91945"],
    [
      "6901  CENTRAL AVE.,Lemon Grove CA 91945 United States of America",
      "6901 central ave lemon grove ca 91945",
    ],
    ["100 North Main Street, Suite 5, Nashville, TN", "100 n main st ste 5 nashville tn"],
  ])("normalizes %j", (address, key) => {
    expect(addressKey(address)).toBe(key);
  });

  it.each([null, "", " , ", "USA"])("has no key for %j", (address) => {
    expect(addressKey(address)).toBeNull();
  });
});
