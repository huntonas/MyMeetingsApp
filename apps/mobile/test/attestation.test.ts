import { ERROR_MESSAGES } from "@mymeetingapp/shared";
import { waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";

import { deleteMine, editTags, removeTags, submitTags, suggestTag } from "@/api/writes";

import { startApi, type TestApi } from "./api-server";
import { setNow } from "./clock";
import {
  attestedChallenges,
  keyIdFor,
  makeKeyStale,
  setAppleTrouble,
  setIntegrity,
  signedClientData,
} from "./native/app-integrity";
import { keychainItem, setKeychainItem, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from "./native/expo-secure-store";

const MEETING_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CHALLENGE = "q3Jw0F2nYc5yQ0d1Gk7mR8sT9uV0wX1yZ2aB3cD4eF5";
const ANSWER = { meetingId: MEETING_ID, tags: [] };
const REFUSED = { error: { code: "attestation_failed", message: ERROR_MESSAGES.attestation_failed } };
const BLOCKED = { error: { code: "device_blocked", message: ERROR_MESSAGES.device_blocked } };
const base64 = (text: string) => Buffer.from(text).toString("base64");
const tagIt = () => submitTags({ meetingId: MEETING_ID, tags: ["quiet"] });

let api: TestApi;
beforeEach(async () => {
  setIntegrity("appAttest");
  api = await startApi();
  // Each path has one method here, so replies are by path: answerLater(path) can then replace one.
  api.reply("/api/v1/attest/challenge", { challenge: CHALLENGE }, 201);
  api.reply("/api/v1/attest/register", { registered: true }, 201);
  api.reply("/api/v1/tags", ANSWER, 201);
  api.reply(`/api/v1/tags/${MEETING_ID}`, ANSWER);
  api.reply("/api/v1/tags/delete-mine", { deletedTags: 0 });
  api.reply("/api/v1/suggestions", { status: "received" }, 202);
});
afterEach(async () => {
  await api.close();
});

const sent = () => api.requests.map((request) => `${request.method} ${request.path}`);
const proofOf = (n: number) => {
  const proof = api.requests[n]?.headers["x-attestation"];
  return typeof proof === "string" ? proof : undefined;
};
const REGISTERING = ["POST /api/v1/attest/challenge", "POST /api/v1/attest/register"];

describe("on an iPhone with App Attest", () => {
  it("makes and registers a key on the first write, then signs exactly that write", async () => {
    setNow("2026-10-05T12:00:00Z");
    await tagIt();
    expect(sent()).toEqual([...REGISTERING, "POST /api/v1/tags"]);
    const [challenge, register, write] = api.requests;
    // The app check's own requests carry the device headers, but no proof.
    expect(challenge?.headers["x-device-id"]).toBe(write?.headers["x-device-id"]);
    expect(challenge?.headers["x-attestation"]).toBeUndefined();
    expect(register?.headers["x-attestation"]).toBeUndefined();
    expect(attestedChallenges).toEqual([CHALLENGE]);
    expect(register?.body).toBe(
      `{"keyId":"${keyIdFor(1)}","attestation":"${base64(`attestation of ${keyIdFor(1)}`)}","challenge":"${CHALLENGE}"}`,
    );
    expect(signedClientData).toEqual([
      `mymeetingapp write v1\nPOST\n/api/v1/tags\n1791201600000\n{"meetingId":"${MEETING_ID}","tags":["quiet"]}`,
    ]);
    expect(write?.headers["x-attestation"]).toBe(
      `appattest.v1.${keyIdFor(1)}.1791201600000.${base64("assertion 1")}`,
    );
  });

  it("keeps the key's id in the Keychain, on this phone only, and signs later writes with it", async () => {
    await tagIt();
    await editTags(MEETING_ID, ["lively"]);
    expect(keychainItem("attest-key-id")).toEqual({
      value: keyIdFor(1),
      options: { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    });
    expect(sent().slice(3)).toEqual([`PUT /api/v1/tags/${MEETING_ID}`]);
    expect(proofOf(3)?.startsWith(`appattest.v1.${keyIdFor(1)}.`)).toBe(true);
  });

  it("registers a new key when the saved one no longer works, as after a reinstall", async () => {
    setKeychainItem("attest-key-id", keyIdFor(9));
    makeKeyStale(keyIdFor(9));
    expect(await tagIt()).toEqual(ANSWER);
    expect(sent()).toEqual([...REGISTERING, "POST /api/v1/tags"]);
    expect(keychainItem("attest-key-id")?.value).toBe(keyIdFor(1));
  });

  it("replaces a key the server no longer holds, once, and sends the write again", async () => {
    setKeychainItem("attest-key-id", keyIdFor(9));
    api.replyOnce("/api/v1/tags", REFUSED, 401, "POST");
    expect(await tagIt()).toEqual(ANSWER);
    expect(sent()).toEqual(["POST /api/v1/tags", ...REGISTERING, "POST /api/v1/tags"]);
    expect(proofOf(3)?.startsWith(`appattest.v1.${keyIdFor(1)}.`)).toBe(true);
  });

  it("shows the server's words when the new key is refused too, and tries no more", async () => {
    setKeychainItem("attest-key-id", keyIdFor(9));
    api.reply("/api/v1/tags", REFUSED, 401, "POST");
    await expect(tagIt()).rejects.toMatchObject(REFUSED.error);
    expect(sent().filter((request) => request === "POST /api/v1/tags")).toHaveLength(2);
  });

  it("keeps its key when the server refuses a write for another reason, and shows the server's words", async () => {
    setKeychainItem("attest-key-id", keyIdFor(1));
    api.reply("/api/v1/tags", BLOCKED, 403, "POST");
    await expect(tagIt()).rejects.toMatchObject(BLOCKED.error);
    expect(sent()).toEqual(["POST /api/v1/tags"]);
    expect(keychainItem("attest-key-id")?.value).toBe(keyIdFor(1));
  });

  it("signs an edit's body, and an empty body for the deletions, which send none", async () => {
    setNow("2026-10-05T12:00:00Z");
    setKeychainItem("attest-key-id", keyIdFor(1));
    await editTags(MEETING_ID, ["lively"]);
    await removeTags(MEETING_ID);
    await deleteMine();
    expect(signedClientData).toEqual([
      `mymeetingapp write v1\nPUT\n/api/v1/tags/${MEETING_ID}\n1791201600000\n{"tags":["lively"]}`,
      `mymeetingapp write v1\nDELETE\n/api/v1/tags/${MEETING_ID}\n1791201600000\n`,
      "mymeetingapp write v1\nPOST\n/api/v1/tags/delete-mine\n1791201600000\n",
    ]);
  });

  it("registers again after Delete all my tags, whose server deleted the key", async () => {
    await tagIt();
    await deleteMine();
    expect(keychainItem("attest-key-id")).toBeUndefined();
    await suggestTag("Candlelight");
    expect(sent().slice(-3)).toEqual([...REGISTERING, "POST /api/v1/suggestions"]);
  });

  it("sends the write without a proof when Apple can't attest right now, and saves no key", async () => {
    setAppleTrouble("unavailable");
    expect(await tagIt()).toEqual(ANSWER);
    expect(sent()).toEqual(["POST /api/v1/attest/challenge", "POST /api/v1/tags"]);
    expect(proofOf(1)).toBeUndefined();
    expect(keychainItem("attest-key-id")).toBeUndefined();
  });

  it("sends the write without a proof when the server refuses the new key, and saves no key", async () => {
    api.replyOnce("/api/v1/attest/register", REFUSED, 401);
    expect(await tagIt()).toEqual(ANSWER);
    expect(sent()).toEqual([...REGISTERING, "POST /api/v1/tags"]);
    expect(proofOf(2)).toBeUndefined();
    expect(keychainItem("attest-key-id")).toBeUndefined();
  });

  it("forgets a key the phone no longer holds, even when Apple can't attest a new one", async () => {
    setKeychainItem("attest-key-id", keyIdFor(9));
    makeKeyStale(keyIdFor(9));
    setAppleTrouble("unavailable");
    expect(await tagIt()).toEqual(ANSWER);
    expect(proofOf(1)).toBeUndefined();
    expect(keychainItem("attest-key-id")).toBeUndefined();
  });

  it("forgets the deleted key before a write queued behind Delete all my tags starts", async () => {
    setKeychainItem("attest-key-id", keyIdFor(9));
    await Promise.all([deleteMine(), suggestTag("Candlelight")]);
    expect(sent()).toEqual(["POST /api/v1/tags/delete-mine", ...REGISTERING, "POST /api/v1/suggestions"]);
    expect(keychainItem("attest-key-id")?.value).toBe(keyIdFor(1));
  });

  it("makes no key while the server can't be reached for a challenge", async () => {
    api.replyOnce("/api/v1/attest/challenge", "offline", 503);
    expect(await tagIt()).toEqual(ANSWER);
    expect(sent()).toEqual(["POST /api/v1/attest/challenge", "POST /api/v1/tags"]);
    expect(proofOf(1)).toBeUndefined();
    await suggestTag("Candlelight");
    expect(keychainItem("attest-key-id")?.value).toBe(keyIdFor(1));
  });

  it("attests the same key again once Apple can be reached, as Apple asks", async () => {
    setAppleTrouble("unavailable");
    await tagIt();
    expect(keychainItem("attest-key-unattested")).toEqual({
      value: keyIdFor(1),
      options: { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    });
    setAppleTrouble("none");
    await suggestTag("Candlelight");
    expect(attestedChallenges).toEqual([CHALLENGE, CHALLENGE]);
    expect(keychainItem("attest-key-id")?.value).toBe(keyIdFor(1));
    expect(keychainItem("attest-key-unattested")).toBeUndefined();
  });

  it("drops a kept key Apple no longer holds, and makes a new one next time", async () => {
    setKeychainItem("attest-key-unattested", keyIdFor(9));
    makeKeyStale(keyIdFor(9));
    expect(await tagIt()).toEqual(ANSWER);
    expect(proofOf(1)).toBeUndefined();
    expect(keychainItem("attest-key-unattested")).toBeUndefined();
    await suggestTag("Candlelight");
    expect(keychainItem("attest-key-id")?.value).toBe(keyIdFor(1));
  });

  it("sends one write at a time, so its assertions arrive in order", async () => {
    setKeychainItem("attest-key-id", keyIdFor(1));
    const answer = api.answerLater("/api/v1/tags");
    const writes = Promise.all([tagIt(), suggestTag("Candlelight")]);
    await waitFor(() => {
      expect(sent()).toEqual(["POST /api/v1/tags"]);
    });
    const answeredAt = Date.now();
    answer(ANSWER);
    await writes;
    expect(sent()).toEqual(["POST /api/v1/tags", "POST /api/v1/suggestions"]);
    expect(api.requests[1]?.at).toBeGreaterThanOrEqual(answeredAt);
    expect(signedClientData.map((text) => text.split("\n")[2])).toEqual([
      "/api/v1/tags",
      "/api/v1/suggestions",
    ]);
  });
});

describe("where App Attest isn't offered", () => {
  it("sends a DeviceCheck token on an iPhone without it, and registers nothing", async () => {
    setIntegrity("deviceCheck");
    await tagIt();
    expect(sent()).toEqual(["POST /api/v1/tags"]);
    expect(proofOf(0)).toBe(`devicecheck.v1.${base64("device check token 1")}`);
  });

  it("makes a new DeviceCheck token for every write, as the server takes each one once", async () => {
    setIntegrity("deviceCheck");
    await tagIt();
    await suggestTag("Candlelight");
    expect(proofOf(1)).toBe(`devicecheck.v1.${base64("device check token 2")}`);
  });

  it("sends the write without a proof when Apple can't make a DeviceCheck token right now", async () => {
    setIntegrity("deviceCheck");
    setAppleTrouble("unavailable");
    expect(await tagIt()).toEqual(ANSWER);
    expect(sent()).toEqual(["POST /api/v1/tags"]);
    expect(proofOf(0)).toBeUndefined();
  });

  it("shows the server's words when it refuses a DeviceCheck token, and sends no other", async () => {
    setIntegrity("deviceCheck");
    api.reply("/api/v1/tags", REFUSED, 401, "POST");
    await expect(tagIt()).rejects.toMatchObject(REFUSED.error);
    expect(sent()).toEqual(["POST /api/v1/tags"]);
  });

  it("shows the server's words when it wants a proof the phone can't make, and sends no other", async () => {
    setIntegrity("none");
    api.reply("/api/v1/tags", REFUSED, 401, "POST");
    await expect(tagIt()).rejects.toMatchObject(REFUSED.error);
    expect(sent()).toEqual(["POST /api/v1/tags"]);
  });

  it("sends the write without a proof on the simulator", async () => {
    setIntegrity("none");
    await tagIt();
    expect(sent()).toEqual(["POST /api/v1/tags"]);
    expect(proofOf(0)).toBeUndefined();
  });

  it("sends the write without a proof on Android, until Play Integrity (Phase 6b)", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    await tagIt();
    expect(sent()).toEqual(["POST /api/v1/tags"]);
    expect(proofOf(0)).toBeUndefined();
  });
});
