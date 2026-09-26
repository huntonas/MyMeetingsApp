import { describe, expect, it } from "vitest";

import { AppConfigResponse } from "../src/index";

const valid = {
  minSupportedVersion: { ios: "1.0.0", android: "1.0.0" },
  latestVersion: { ios: "1.2.0", android: "1.2.1" },
  features: { tagging: true, suggestions: false },
};

describe("AppConfigResponse", () => {
  it("accepts a valid config", () => {
    expect(AppConfigResponse.parse(valid)).toEqual(valid);
  });

  it("rejects a malformed version", () => {
    const config = { ...valid, minSupportedVersion: { ios: "1.0", android: "1.0.0" } };
    expect(AppConfigResponse.safeParse(config).success).toBe(false);
  });

  it("rejects a missing platform", () => {
    const config = { ...valid, latestVersion: { ios: "1.2.0" } };
    expect(AppConfigResponse.safeParse(config).success).toBe(false);
  });
});
