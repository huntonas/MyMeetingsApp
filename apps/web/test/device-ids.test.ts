import { afterEach, describe, expect, it, vi } from "vitest";

import { deviceHash, submitterId, submitterIds } from "@/server/devices/ids";

afterEach(() => {
  vi.unstubAllEnvs();
});

const IOS_ID = "6F9619FF-8B86-D011-B42D-00C04FC964FF";
const HASH = "843ff89c9bc545aa6c2c749daa73a089752171a990aa930ce3aeb18c06ebffc4";
const MEETING_1 = "0f8fad5b-d9cb-469f-a165-70867728950e";
const MEETING_2 = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("deviceHash", () => {
  it("is an HMAC of platform and raw id under a key derived from the pepper", () => {
    expect(deviceHash("ios", IOS_ID)).toBe(HASH);
  });

  it("differs by platform for the same raw id", () => {
    expect(deviceHash("android", IOS_ID)).toBe(
      "5438bc0765710934072a23b4129bbf0105bb02c0c929ccb0bf8a9b2bf07a8eeb",
    );
  });

  it.each([undefined, "too-short-to-be-a-pepper"])("refuses to hash with pepper %j", (pepper) => {
    vi.stubEnv("DEVICE_ID_PEPPER", pepper);
    expect(() => deviceHash("ios", IOS_ID)).toThrow("DEVICE_ID_PEPPER must be set to at least 32 characters");
  });
});

describe("submitter ids", () => {
  it("give one device a different id on each meeting", () => {
    expect(submitterIds(HASH, [MEETING_1, MEETING_2])).toEqual([
      "7755aa9b8aaa4d92169180d8c4533358bf4a579133c50f7e79665c965ebfc98a",
      "f5971d2deecacec9ea812255fec568b345ad00fb25f620e5a45359b1a92cc8cf",
    ]);
  });

  it("are the same one at a time", () => {
    expect(submitterId(HASH, MEETING_1)).toBe(
      "7755aa9b8aaa4d92169180d8c4533358bf4a579133c50f7e79665c965ebfc98a",
    );
  });
});
