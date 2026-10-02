import { Platform } from "react-native";

import { checkAttendance } from "@/location/attendance";
import { attendanceOccurrence, checkablePlace } from "@/tagging/window";

import { meeting } from "./fixtures";
import {
  permissionRequests,
  positionOptions,
  setDevicePosition,
  setLocationPermission,
  setPermissionAnswer,
  setPrecise,
  setPreciseAnswer,
} from "./native/expo-location";
import { setTemporaryAccuracyAnswer, temporaryAccuracyRequests } from "./native/native-location";

const ST_LUKES = { latitude: 36.1627, longitude: -86.7816 };
// 0.0013° of latitude is about 145 m; 0.00193° about 215 m; 0.00203° about 226 m; 0.0023° about 256 m; 0.004° about
// 445 m; 0.00445° about 495 m; 0.00454° about 505 m; 0.0053° about 589 m.
const at = (dLat: number, accuracy = 20) => ({ latitude: 36.1627 + dLat, longitude: -86.7816, accuracy });

describe("checkAttendance (spec §8: 200 m plus the fix's accuracy, at most 500 m)", () => {
  beforeEach(() => {
    setLocationPermission("granted");
  });

  it.each([
    ["145 m away, 20 m accuracy", at(0.0013), "near"],
    ["215 m away, 20 m accuracy (within 220)", at(0.00193), "near"],
    ["226 m away, 20 m accuracy (past 220)", at(0.00203), "notNear"],
    ["495 m away, 400 m accuracy (within the 500 cap)", at(0.00445, 400), "near"],
    ["505 m away, 400 m accuracy (past the 500 cap)", at(0.00454, 400), "notNear"],
    ["256 m away, 20 m accuracy", at(0.0023), "notNear"],
    ["256 m away, 100 m accuracy", at(0.0023, 100), "near"],
    ["445 m away, 400 m accuracy (capped at 500)", at(0.004, 400), "near"],
    ["589 m away, 400 m accuracy (capped at 500)", at(0.0053, 400), "notNear"],
  ])("%s", async (_where, position, answer) => {
    setDevicePosition(position);
    expect(await checkAttendance(ST_LUKES, "open")).toBe(answer);
  });

  it("asks for a precise fix, and lets Android offer to turn location on only after a tap", async () => {
    setDevicePosition(at(0.0013));
    await checkAttendance(ST_LUKES, "open");
    await checkAttendance(ST_LUKES, "tap");
    expect(positionOptions()).toEqual([
      { accuracy: 4, mayShowUserSettingsDialog: false },
      { accuracy: 4, mayShowUserSettingsDialog: true },
    ]);
  });

  it("never shows a dialog when a page opens: no permission is 'denied', approximate is 'approximate'", async () => {
    setLocationPermission("undetermined");
    expect(await checkAttendance(ST_LUKES, "open")).toBe("denied");
    setLocationPermission("granted");
    setPrecise(false);
    expect(await checkAttendance(ST_LUKES, "open")).toBe("approximate");
    expect(permissionRequests()).toBe(0);
    expect(temporaryAccuracyRequests).toEqual([]);
  });

  it("asks for temporary full accuracy on an iPhone sharing only approximate location, when the person taps", async () => {
    setPrecise(false);
    setDevicePosition(at(0.0013));
    expect(await checkAttendance(ST_LUKES, "tap")).toBe("near");
    expect(temporaryAccuracyRequests).toEqual(["AttendanceCheck"]);
    expect(permissionRequests()).toBe(0);
  });

  it("stays approximate when the person keeps approximate location", async () => {
    setPrecise(false);
    setTemporaryAccuracyAnswer(false);
    expect(await checkAttendance(ST_LUKES, "tap")).toBe("approximate");
  });

  it("asks Android for precise location when the person taps", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    setPrecise(false);
    setPreciseAnswer(true);
    setDevicePosition(at(0.0013));
    expect(await checkAttendance(ST_LUKES, "tap")).toBe("near");
    expect(permissionRequests()).toBe(1);
    expect(temporaryAccuracyRequests).toEqual([]);
  });

  it("stays approximate on Android when the person keeps approximate location", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    setPrecise(false);
    setPreciseAnswer(false);
    expect(await checkAttendance(ST_LUKES, "tap")).toBe("approximate");
  });

  it("asks for permission on a tap when none was given, and respects a no", async () => {
    setLocationPermission("undetermined");
    // The fake's person answers "granted" unless told otherwise; this one says no.
    setPermissionAnswer("denied");
    expect(await checkAttendance(ST_LUKES, "tap")).toBe("denied");
    expect(permissionRequests()).toBe(1);
  });

  it("checks once permission is given on a tap", async () => {
    setLocationPermission("undetermined");
    setDevicePosition(at(0.0013));
    expect(await checkAttendance(ST_LUKES, "tap")).toBe("near");
  });

  it("is 'unavailable' when the request for full accuracy fails", async () => {
    setPrecise(false);
    setTemporaryAccuracyAnswer("fails");
    expect(await checkAttendance(ST_LUKES, "tap")).toBe("unavailable");
  });

  it("is 'unavailable' when the phone can't find itself", async () => {
    setDevicePosition("fails");
    expect(await checkAttendance(ST_LUKES, "open")).toBe("unavailable");
  });
});

describe("attendanceOccurrence (15 min before the start to 30 min after the end, or 90 min after a start with no end)", () => {
  const NOONERS = { day: 1, time: "12:00", endTime: "13:00", timezone: "America/Chicago" };
  it.each([
    ["16 minutes before", "2026-10-05T16:44:00Z", null],
    ["15 minutes before", "2026-10-05T16:45:00Z", "2026-10-05T17:00:00Z"],
    ["29 minutes after the end", "2026-10-05T18:29:00Z", "2026-10-05T17:00:00Z"],
    ["30 minutes after the end", "2026-10-05T18:30:00Z", null],
  ])("%s", (_when, now, start) => {
    expect(attendanceOccurrence(NOONERS, new Date(now))?.start ?? null).toEqual(
      start === null ? null : new Date(start),
    );
  });

  it("allows 90 minutes after the start when there's no end time", () => {
    const noEnd = { ...NOONERS, endTime: null };
    expect(attendanceOccurrence(noEnd, new Date("2026-10-05T18:29:00Z"))?.start).toEqual(
      new Date("2026-10-05T17:00:00Z"),
    );
    expect(attendanceOccurrence(noEnd, new Date("2026-10-05T18:30:00Z"))).toBeNull();
  });

  it("treats an end time equal to the start as no end time", () => {
    const sameEnd = { ...NOONERS, endTime: "12:00" };
    expect(attendanceOccurrence(sameEnd, new Date("2026-10-05T18:29:00Z"))?.start).toEqual(
      new Date("2026-10-05T17:00:00Z"),
    );
  });
});

describe("checkablePlace", () => {
  it("is the map point of an in-person or hybrid meeting", () => {
    expect(checkablePlace(meeting())).toEqual({ latitude: 36.1627, longitude: -86.7816 });
    expect(checkablePlace(meeting({ attendance: "hybrid" }))).toEqual({
      latitude: 36.1627,
      longitude: -86.7816,
    });
  });

  it("is null for an online meeting, even one listed with a map point, and for a place with no point", () => {
    expect(checkablePlace(meeting({ attendance: "online" }))).toBeNull();
    expect(checkablePlace(meeting({ latitude: null, longitude: null }))).toBeNull();
  });
});
