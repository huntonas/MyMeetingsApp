import { ZodError } from "zod";

import { ApiError, Unreachable } from "@/api/client";
import { fetchMeeting, fetchOnlineMeetings, fetchVocabulary, searchMeetings } from "@/api/reads";

import { startApi, type TestApi } from "./api-server";
import { TIMEOUT_ONLY } from "./clock";
import { meeting, VOCABULARY } from "./fixtures";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
let api: TestApi;

beforeEach(async () => {
  api = await startApi();
});
afterEach(async () => {
  await api.close();
});

describe("reads", () => {
  it("reads the tag list through its contract, with no device headers", async () => {
    api.reply("/api/v1/vocabulary", VOCABULARY);
    expect(await fetchVocabulary()).toEqual(VOCABULARY);
    const [request] = api.requests;
    expect(request?.method).toBe("GET");
    for (const header of ["x-device-id", "x-platform", "x-app-version", "x-attestation"]) {
      expect(request?.headers[header]).toBeUndefined();
    }
  });

  it("drops fields the contract doesn't name", async () => {
    api.reply(`/api/v1/meetings/${ID}`, { meeting: { ...meeting(), internalNote: "x" } });
    expect(await fetchMeeting(ID)).toEqual({ meeting: meeting() });
  });

  it("reads one weekday of online meetings", async () => {
    api.reply("/api/v1/meetings/online?day=3", { meetings: [] });
    expect(await fetchOnlineMeetings(3)).toEqual({ meetings: [] });
  });
});

describe("search", () => {
  it("sends only the rounded point and radius, in the POST body and never the URL", async () => {
    api.reply("/api/v1/meetings/search", { meetings: [] });
    await searchMeetings({ lat: 36.16, lng: -86.78, radiusKm: 25 });
    const [request] = api.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/v1/meetings/search");
    expect(JSON.parse(request?.body ?? "")).toEqual({ lat: 36.16, lng: -86.78, radiusKm: 25 });
  });

  it("refuses to send a point that isn't rounded", async () => {
    await expect(searchMeetings({ lat: 36.162, lng: -86.78, radiusKm: 25 })).rejects.toBeInstanceOf(ZodError);
    expect(api.requests).toHaveLength(0);
  });
});

describe("failures", () => {
  it("turns the server's error envelope into its code and plain-language message", async () => {
    const message = "We couldn't find that meeting. It may have been removed from the meeting list.";
    api.reply(`/api/v1/meetings/${ID}`, { error: { code: "meeting_not_found", message } }, 404);
    const error: unknown = await fetchMeeting(ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "meeting_not_found", message });
  });

  it("treats a reply that breaks the contract as unreachable", async () => {
    api.reply(`/api/v1/meetings/${ID}`, { meeting: { ...meeting(), day: 9 } });
    await expect(fetchMeeting(ID)).rejects.toBeInstanceOf(Unreachable);
  });

  it("treats a refused connection as unreachable", async () => {
    await api.close();
    await expect(fetchVocabulary()).rejects.toBeInstanceOf(Unreachable);
    api = await startApi();
  });

  it("gives up on a server that doesn't answer within 15 seconds", async () => {
    jest.useFakeTimers(TIMEOUT_ONLY);
    api.hang("/api/v1/vocabulary");
    let settled = false;
    const pending = fetchVocabulary()
      .catch((caught: unknown) => caught)
      .finally(() => {
        settled = true;
      });
    while (api.requests.length === 0) await new Promise((resolve) => setImmediate(resolve));
    await jest.advanceTimersByTimeAsync(14_999);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await pending).toBeInstanceOf(Unreachable);
  });
});
