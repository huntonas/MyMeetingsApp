import { ERROR_MESSAGES } from "@mymeetingapp/shared";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, AppState, type AppStateStatus } from "react-native";

import { appDatabase } from "@/db/database";
import { recordNear, wasNear } from "@/tagging/attendance-record";
import { recordSubmission } from "@/tagging/my-tags";

import { startApi, type TestApi } from "./api-server";
import { failStatements, resetAppData, storedCells } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, VOCABULARY } from "./fixtures";
import { later } from "./later";
import {
  permissionChecks,
  permissionRequests,
  positionReads,
  positionsDelivered,
  setDevicePosition,
  setLocationPermission,
  setPermissionAnswer,
  setPrecise,
} from "./native/expo-location";
import { setTemporaryAccuracyAnswer } from "./native/native-location";
import { launchReadsLanded, renderApp } from "./render-app";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PATH = `/api/v1/meetings/${ID}`;
// Nooners (fixtures.ts) meets Mondays 12:00–1:00 PM in Chicago, at St. Luke's: Monday 5 October 2026 at noon is
// 17:00 UTC.
const STARTED = "2026-10-05T17:00:00Z";
const COUNTS = [
  { slug: "welcoming", count: 14 },
  { slug: "quiet", count: 1 },
];
// About 145 m from St. Luke's, with digits nothing else in the app has, so a stored copy would show.
const NEAR = { latitude: 36.16401, longitude: -86.78163 };
const FAR = { latitude: 36.2, longitude: -86.7816 };
const EXPLANATION = "We check you're near the meeting to stop spam. Your location never leaves your phone.";
const CHECK = "Check I'm near the meeting";
const NEAR_LINE = "You're near the meeting. Your tags will say so.";

let api: TestApi;
let announce: jest.SpyInstance;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v2/vocabulary", VOCABULARY);
  api.reply(PATH, { meeting: meeting() });
  api.reply("/api/v1/tags", { meetingId: ID, tags: COUNTS }, 201, "POST");
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});
afterEach(async () => {
  await api.close();
});

const tagWrites = () => api.requests.filter((r) => r.path === "/api/v1/tags");

// AppState is what the app hands foreground changes off to; the spy lets a test play them.
function spyOnAppState() {
  const listeners = new Set<(state: AppStateStatus) => void>();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    listeners.add(listener);
    return {
      remove: () => {
        listeners.delete(listener);
      },
    };
  });
  return async (state: AppStateStatus) => {
    await act(() => {
      for (const listener of listeners) listener(state);
    });
  };
}

// The page has drawn the meeting, and its tag section has read the phone's record (the button stands for both).
async function openMeeting(at: string) {
  setNow(at);
  await renderApp(`/meeting/${ID}`);
  await screen.findByLabelText("Welcoming 14 people");
  await screen.findByRole("button", { name: "Tag this meeting" });
}

async function openPicker() {
  await fireEvent.press(screen.getByRole("button", { name: "Tag this meeting" }));
}

async function tag(label: string) {
  await openPicker();
  await fireEvent.press(screen.getByRole("checkbox", { name: label }));
  await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
  await screen.findByText("Thanks. Your tags are added.");
}

describe("the attendance check", () => {
  it("checks silently when a meeting page opens during the meeting, with location already allowed, and sends nearMeeting", async () => {
    setLocationPermission("granted");
    setDevicePosition(NEAR);
    await openMeeting("2026-10-05T17:10:00Z");
    await waitFor(async () => {
      expect(await wasNear(ID, new Date(STARTED))).toBe(true);
    });
    expect(permissionRequests()).toBe(0);
    await tag("Quiet");
    expect(tagWrites()[0]?.body).toBe(`{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":true}`);
  });

  it("counts a check made just before the meeting for the tags sent once it has started", async () => {
    setLocationPermission("granted");
    setDevicePosition(NEAR);
    setNow("2026-10-05T16:50:00Z");
    await renderApp(`/meeting/${ID}`);
    await waitFor(async () => {
      expect(await wasNear(ID, new Date(STARTED))).toBe(true);
    });
    await launchReadsLanded();
    await cleanup();
    setDevicePosition(FAR);
    await openMeeting("2026-10-05T19:00:00Z");
    await tag("Quiet");
    expect(tagWrites()[0]?.body).toBe(`{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":true}`);
  });

  it("keeps nothing when the silent check finds the phone elsewhere", async () => {
    setLocationPermission("granted");
    setDevicePosition(FAR);
    await openMeeting("2026-10-05T17:10:00Z");
    await waitFor(() => {
      expect(positionsDelivered()).toBe(1);
    });
    await tag("Quiet");
    expect(tagWrites()[0]?.body).toBe(`{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":false}`);
    expect(await wasNear(ID, new Date(STARTED))).toBe(false);
    // The write's new counts don't start a second look.
    expect(positionReads()).toBe(1);
  });

  it("doesn't look again when the page reads the meeting's counts afresh", async () => {
    const appState = spyOnAppState();
    setLocationPermission("granted");
    setDevicePosition(FAR);
    await openMeeting("2026-10-05T17:10:00Z");
    await waitFor(() => {
      expect(positionsDelivered()).toBe(1);
    });
    // Past the copy's reuse window and still in the meeting's time, so coming back reads the meeting again.
    setNow("2026-10-05T18:20:00Z");
    api.reply(PATH, { meeting: meeting({ tags: [{ slug: "welcoming", count: 15 }] }) });
    await appState("background");
    await appState("active");
    expect(await screen.findByLabelText("Welcoming 15 people")).toBeOnTheScreen();
    expect(positionReads()).toBe(1);
  });

  it.each([
    [
      "tagging is switched off",
      { ...CONFIG, features: { tagging: false, suggestions: true } },
      ERROR_MESSAGES.tags_disabled,
    ],
    [
      "the app is below the minimum version",
      { ...CONFIG, minSupportedVersion: { ios: "9.0.0", android: "9.0.0" } },
      ERROR_MESSAGES.upgrade_required,
    ],
  ])("doesn't look when %s, even before the config has been read", async (_why, config, message) => {
    api.reply("/api/v1/config", config);
    setLocationPermission("granted");
    setDevicePosition(NEAR);
    setNow("2026-10-05T17:10:00Z");
    await renderApp(`/meeting/${ID}`);
    expect(await screen.findByText(message)).toBeOnTheScreen();
    await launchReadsLanded();
    expect(permissionChecks()).toBe(0);
    expect(positionReads()).toBe(0);
  });

  it("still checks offline with no config, as writes still go", async () => {
    api.reply("/api/v1/config", { error: { code: "server_error", message: "Something went wrong." } }, 500);
    setLocationPermission("granted");
    setDevicePosition(NEAR);
    await openMeeting("2026-10-05T17:10:00Z");
    await waitFor(async () => {
      expect(await wasNear(ID, new Date(STARTED))).toBe(true);
    });
  });

  it("does nothing without permission, and never asks", async () => {
    setLocationPermission("undetermined");
    await openMeeting("2026-10-05T17:10:00Z");
    // The check looked at the permission, and stopped there.
    await waitFor(() => {
      expect(permissionChecks()).toBeGreaterThan(0);
    });
    await launchReadsLanded();
    expect(positionReads()).toBe(0);
    expect(permissionRequests()).toBe(0);
  });

  it("does nothing with only approximate location shared, and never asks for more", async () => {
    setLocationPermission("granted");
    setPrecise(false);
    await openMeeting("2026-10-05T17:10:00Z");
    await waitFor(() => {
      expect(permissionChecks()).toBeGreaterThan(0);
    });
    await launchReadsLanded();
    expect(positionReads()).toBe(0);
    expect(permissionRequests()).toBe(0);
  });

  it("doesn't look at all outside the meeting's time (2 PM, past 1:30 PM)", async () => {
    setLocationPermission("granted");
    await openMeeting("2026-10-05T19:00:00Z");
    await launchReadsLanded();
    await openPicker();
    expect(screen.getByRole("header", { name: "Tag this meeting" })).toBeOnTheScreen();
    expect(screen.queryByText(EXPLANATION)).toBeNull();
    expect(permissionChecks()).toBe(0);
    expect(positionReads()).toBe(0);
  });

  it("doesn't look when the group asked not to be tagged", async () => {
    api.reply(PATH, { meeting: meeting({ tagsDisabled: true }) });
    setLocationPermission("granted");
    setNow("2026-10-05T17:10:00Z");
    await renderApp(`/meeting/${ID}`);
    await launchReadsLanded();
    await screen.findByText("This group has asked not to be tagged.");
    expect(permissionChecks()).toBe(0);
    expect(positionReads()).toBe(0);
  });

  it("offers the check in the picker with the spec's explanation, and keeps only a near result", async () => {
    setLocationPermission("undetermined");
    setDevicePosition(FAR);
    await openMeeting("2026-10-05T17:10:00Z");
    await openPicker();
    expect(screen.getByText(EXPLANATION)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: CHECK })).toHaveProp(
      "accessibilityHint",
      "Uses your location once, on this phone",
    );
    await fireEvent.press(screen.getByRole("button", { name: CHECK }));
    const away = "You don't seem to be at the meeting, so your tags will go without that.";
    expect(await screen.findByText(away)).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(away);
    expect(permissionRequests()).toBe(1);
    expect(await wasNear(ID, new Date(STARTED))).toBe(false);
    setDevicePosition(NEAR);
    await fireEvent.press(screen.getByRole("button", { name: CHECK }));
    expect(await screen.findByText(NEAR_LINE)).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith(NEAR_LINE);
    expect(screen.queryByRole("button", { name: CHECK })).toBeNull();
    expect(await wasNear(ID, new Date(STARTED))).toBe(true);
    await fireEvent.press(screen.getByRole("checkbox", { name: "Quiet" }));
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    await screen.findByText("Thanks. Your tags are added.");
    expect(tagWrites()[0]?.body).toBe(`{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":true}`);
  });

  it("says the phone is near, with nothing to press, when a check already found it, and doesn't look again", async () => {
    setLocationPermission("granted");
    await recordNear(ID, new Date(STARTED));
    await openMeeting("2026-10-05T17:10:00Z");
    await openPicker();
    expect(await screen.findByText(NEAR_LINE)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: CHECK })).toBeNull();
    await launchReadsLanded();
    expect(permissionChecks()).toBe(0);
    expect(positionReads()).toBe(0);
  });

  it("can't be started twice while the phone is still finding itself", async () => {
    setLocationPermission("granted");
    setPrecise(false);
    const fix = later<typeof NEAR>();
    setDevicePosition(fix.promise);
    await openMeeting("2026-10-05T17:10:00Z");
    await openPicker();
    await fireEvent.press(screen.getByRole("button", { name: CHECK }));
    expect(await screen.findByLabelText("Checking where you are")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: CHECK })).toBeNull();
    fix.resolve(NEAR);
    expect(await screen.findByText(NEAR_LINE)).toBeOnTheScreen();
    expect(positionReads()).toBe(1);
  });

  it.each([
    [
      "location isn't allowed",
      () => {
        setLocationPermission("undetermined");
        setPermissionAnswer("denied");
      },
      "Location isn't allowed for My Meeting App, so your tags will go without the check.",
    ],
    [
      "only approximate location is shared",
      () => {
        setLocationPermission("granted");
        setPrecise(false);
        setTemporaryAccuracyAnswer(false);
      },
      "Only your approximate location is shared, so your tags will go without the check.",
    ],
    [
      "the phone can't find itself",
      () => {
        setLocationPermission("granted");
        setPrecise(false);
        setDevicePosition("fails");
      },
      "Your phone couldn't find where it is, so your tags will go without the check.",
    ],
  ])("says so when %s, and offers the check again", async (_why, arrange, line) => {
    arrange();
    await openMeeting("2026-10-05T17:10:00Z");
    await openPicker();
    await fireEvent.press(screen.getByRole("button", { name: CHECK }));
    expect(await screen.findByText(line)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: CHECK })).toBeOnTheScreen();
    expect(await wasNear(ID, new Date(STARTED))).toBe(false);
  });

  it("says the phone failed, rather than that it's near, when it can't keep the result", async () => {
    // Approximate location: the page's own check stops there, and the tap asks for full accuracy.
    setLocationPermission("granted");
    setPrecise(false);
    setDevicePosition(NEAR);
    await failStatements("runAsync", "insert or ignore into attendance_checks");
    await openMeeting("2026-10-05T17:10:00Z");
    await openPicker();
    await fireEvent.press(screen.getByRole("button", { name: CHECK }));
    expect(await screen.findByText("Something went wrong on this phone. Try again.")).toBeOnTheScreen();
    expect(screen.queryByText(NEAR_LINE)).toBeNull();
    expect(screen.getByRole("button", { name: CHECK })).toBeOnTheScreen();
  });

  it("sends nearMeeting false without a check, and for an online meeting never offers one", async () => {
    api.reply(PATH, {
      meeting: meeting({ attendance: "online", conferenceUrl: "https://zoom.us/j/1" }),
    });
    // Even a result kept for it (the meeting moved online since) isn't sent: there's nowhere to be near.
    await recordNear(ID, new Date(STARTED));
    await openMeeting("2026-10-05T17:10:00Z");
    await openPicker();
    expect(screen.queryByText(EXPLANATION)).toBeNull();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Quiet" }));
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    await screen.findByText("Thanks. Your tags are added.");
    expect(tagWrites()[0]?.body).toBe(`{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":false}`);
  });

  it("isn't offered when editing tags, which never carry it", async () => {
    await recordSubmission({ id: ID, name: "Nooners" }, ["welcoming"], new Date(STARTED));
    setNow("2026-10-05T17:10:00Z");
    await renderApp(`/meeting/${ID}`);
    await fireEvent.press(await screen.findByRole("button", { name: "Edit my tags" }));
    expect(screen.getByRole("header", { name: "Edit my tags" })).toBeOnTheScreen();
    expect(screen.queryByText(EXPLANATION)).toBeNull();
    await launchReadsLanded();
  });

  it("still sends the tags, without nearMeeting true, when the phone can't read its results", async () => {
    await recordNear(ID, new Date(STARTED));
    await failStatements("getFirstAsync", "select 1 from attendance_checks");
    await openMeeting("2026-10-05T17:10:00Z");
    await openPicker();
    // Unreadable, so the offer stands rather than claiming the phone is near.
    expect(await screen.findByRole("button", { name: CHECK })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("checkbox", { name: "Quiet" }));
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    await screen.findByText("Thanks. Your tags are added.");
    expect(tagWrites()[0]?.body).toBe(`{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":false}`);
  });

  it("keeps no position on the phone, only that the check said near", async () => {
    setLocationPermission("granted");
    setDevicePosition(NEAR);
    await openMeeting("2026-10-05T17:10:00Z");
    await waitFor(async () => {
      expect(await wasNear(ID, new Date(STARTED))).toBe(true);
    });
    const db = await appDatabase();
    expect(await db.getAllAsync("select * from attendance_checks", [])).toEqual([
      { meeting_id: ID, occurrence_start: new Date(STARTED).getTime() },
    ]);
    // Nor anywhere else: every cell of every table, as text, holds neither coordinate.
    for (const cell of await storedCells()) expect(cell).not.toMatch(/36\.16401|86\.78163/);
  });
});
