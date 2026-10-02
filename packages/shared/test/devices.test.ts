import { describe, expect, it } from "vitest";

import { WriteHeaders } from "../src/index";

describe("WriteHeaders", () => {
  it.each([
    ["an iOS Keychain UUID", "6F9619FF-8B86-D011-B42D-00C04FC964FF"],
    ["a 16-hex-digit ANDROID_ID", "dd96dec43fb81c97"],
  ])("accepts %s", (_kind, deviceId) => {
    expect(WriteHeaders.parse({ deviceId, platform: "ios", appVersion: "0.1.0" })).toEqual({
      deviceId,
      platform: "ios",
      appVersion: "0.1.0",
    });
  });

  it.each([
    ["shorter than 16 characters", "dd96dec43fb81c9"],
    ["with characters an ID never has", "dd96dec4 3fb81c97"],
    ["longer than 64 characters", "a".repeat(65)],
  ])("refuses an ID %s", (_why, deviceId) => {
    expect(WriteHeaders.safeParse({ deviceId, platform: "ios", appVersion: "0.1.0" }).success).toBe(false);
  });
});
