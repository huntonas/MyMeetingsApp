import { ERROR_MESSAGES } from "@mymeetingapp/shared";
import { Platform } from "react-native";

import { fetchVocabulary } from "@/api/reads";
import { deleteMine } from "@/api/writes";

import { startApi, type TestApi } from "./api-server";
import { VOCABULARY } from "./fixtures";
import { setAndroidId, setAppVersion } from "./native/expo-application";
import {
  keychainItem,
  keychainWrites,
  setKeychainItem,
  setKeychainTrouble,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} from "./native/expo-secure-store";

const DELETE_MINE = "/api/v1/tags/delete-mine";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYCHAIN_ID = "6F9619FF-8B86-D011-B42D-00C04FC964FF";

let api: TestApi;
beforeEach(async () => {
  api = await startApi();
  api.reply(DELETE_MINE, { deletedTags: 0 }, 200, "POST");
});
afterEach(async () => {
  await api.close();
});

const sentId = (n = 0) => api.requests[n]?.headers["x-device-id"];

describe("the phone's ID", () => {
  it("is made on an iPhone's first write and kept in the Keychain, readable only on this phone", async () => {
    await deleteMine();
    expect(sentId()).toMatch(UUID_V4);
    expect(keychainItem("device-id")).toEqual({
      value: sentId(),
      options: { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    });
  });

  it("is the same on every later write", async () => {
    await deleteMine();
    await deleteMine();
    expect(sentId(1)).toBe(sentId(0));
    expect(keychainWrites()).toBe(1);
  });

  it("is made once when two first writes start together", async () => {
    await Promise.all([deleteMine(), deleteMine()]);
    expect(sentId(1)).toBe(sentId(0));
    expect(keychainWrites()).toBe(1);
  });

  it("is the one already in the Keychain, as after the app is reinstalled", async () => {
    setKeychainItem("device-id", KEYCHAIN_ID);
    await deleteMine();
    expect(sentId()).toBe(KEYCHAIN_ID);
    expect(keychainWrites()).toBe(0);
  });

  // Nothing that fails the server's ID check can have been sent, so replacing it loses no tags.
  it("is made afresh when what the Keychain holds isn't an ID", async () => {
    setKeychainItem("device-id", "not an id");
    await deleteMine();
    expect(sentId()).toMatch(UUID_V4);
    expect(keychainItem("device-id")?.value).toBe(sentId());
  });

  it("is never replaced when the Keychain can't be read, and nothing is sent", async () => {
    setKeychainTrouble("fails");
    await expect(deleteMine()).rejects.toThrow("Keychain unavailable");
    expect(api.requests).toEqual([]);
    expect(keychainWrites()).toBe(0);
  });

  it("is ANDROID_ID on Android, and the Keychain is never touched", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    await deleteMine();
    expect(sentId()).toBe("dd96dec43fb81c97");
    expect(api.requests[0]?.headers["x-platform"]).toBe("android");
    expect(keychainItem("device-id")).toBeUndefined();
  });

  // Android 7 writes ANDROID_ID with Long.toHexString, which drops leading zeros.
  it("gets back the leading zeros Android 7 drops from ANDROID_ID", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    setAndroidId("6dec43fb81c97");
    await deleteMine();
    expect(sentId()).toBe("0006dec43fb81c97");
  });

  it.each(["", "dd96dec4 3fb81c97"])("stops the write when ANDROID_ID is %j", async (id) => {
    jest.replaceProperty(Platform, "OS", "android");
    setAndroidId(id);
    await expect(deleteMine()).rejects.toThrow();
    expect(api.requests).toEqual([]);
  });

  it("stops the write when the app's own version can't be read", async () => {
    setAppVersion(null);
    await expect(deleteMine()).rejects.toThrow();
    expect(api.requests).toEqual([]);
  });
});

describe("writes", () => {
  it("carry the three device headers, no attestation yet, and no body when there's nothing to send", async () => {
    expect(await deleteMine()).toEqual({ deletedTags: 0 });
    const [request] = api.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe(DELETE_MINE);
    expect(request?.body).toBe("");
    expect(request?.headers["content-type"]).toBeUndefined();
    expect(request?.headers["x-platform"]).toBe("ios");
    expect(request?.headers["x-app-version"]).toBe("0.1.0");
    expect(request?.headers["x-attestation"]).toBeUndefined();
  });

  it("send no cookies", async () => {
    const spy = jest.spyOn(globalThis, "fetch");
    await deleteMine();
    expect(spy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "POST", credentials: "omit" }),
    );
  });

  it("turn the server's refusal into its plain message", async () => {
    api.reply(
      DELETE_MINE,
      { error: { code: "attestation_failed", message: ERROR_MESSAGES.attestation_failed } },
      403,
      "POST",
    );
    await expect(deleteMine()).rejects.toMatchObject({
      code: "attestation_failed",
      message: "We couldn't confirm this request came from the app. Please update the app and try again.",
    });
  });

  it("leave later reads without any device header", async () => {
    api.reply("/api/v1/vocabulary", VOCABULARY);
    await deleteMine();
    await fetchVocabulary();
    const read = api.requests[1];
    for (const header of ["x-device-id", "x-platform", "x-app-version", "x-attestation"]) {
      expect(read?.headers[header]).toBeUndefined();
    }
  });
});
