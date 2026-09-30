import { MeetingSearchRequest } from "@mymeetingapp/shared";

import { currentPosition, locationAlreadyAllowed } from "@/location/current-position";
import { findPlace } from "@/location/find-place";
import { distanceKm, radiusForRegion, roundForSearch } from "@/location/geo";
import { forgetRecentPlaces, recentPlaces, rememberPlace } from "@/location/recent-places";

import { resetAppData } from "./app-data";
import { setNow, TIMEOUT_ONLY } from "./clock";
import {
  permissionRequests,
  positionOptions,
  positionReads,
  setCanAskAgain,
  setDevicePosition,
  setLocationPermission,
  setPermissionAnswer,
} from "./native/expo-location";
import { lookups, setGeocoderTrouble, setPlace } from "./native/native-location";

// Settles `work` into a flag a test can read while fake time moves on.
function track<T>(work: Promise<T>): { settled: () => boolean; result: Promise<T> } {
  let done = false;
  const result = work.finally(() => {
    done = true;
  });
  return { settled: () => done, result };
}

beforeEach(async () => {
  await resetAppData();
});

describe("roundForSearch", () => {
  it("rounds to 2 decimal places, about 1 km", () => {
    expect(roundForSearch({ latitude: 36.162749, longitude: -86.781602 })).toEqual({
      latitude: 36.16,
      longitude: -86.78,
    });
    expect(roundForSearch({ latitude: 35.756512, longitude: -83.970498 })).toEqual({
      latitude: 35.76,
      longitude: -83.97,
    });
    // Halves round away from zero on both sides of the equator and the meridian.
    expect(roundForSearch({ latitude: 35.7555, longitude: -83.9765 })).toEqual({
      latitude: 35.76,
      longitude: -83.98,
    });
  });

  it.each([36.162749, -86.781602, 1.005, 2.675, 45.125, 89.999, -179.996, 0.004])(
    "always gives a point the server accepts (%s)",
    (value) => {
      const point = roundForSearch({ latitude: Math.max(-90, Math.min(90, value)), longitude: value });
      expect(
        MeetingSearchRequest.safeParse({ lat: point.latitude, lng: point.longitude, radiusKm: 25 }).success,
      ).toBe(true);
    },
  );
});

describe("distanceKm", () => {
  it("measures great-circle distance", () => {
    expect(
      distanceKm({ latitude: 36.1627, longitude: -86.7816 }, { latitude: 35.9606, longitude: -83.9207 }),
    ).toBeCloseTo(258.13, 1);
    expect(
      distanceKm({ latitude: 36.1627, longitude: -86.7816 }, { latitude: 36.1627, longitude: -86.7816 }),
    ).toBe(0);
  });
});

describe("radiusForRegion", () => {
  it.each([
    [{ latitude: 36.16, longitude: -86.78, latitudeDelta: 0.2, longitudeDelta: 0.3 }, 18],
    [{ latitude: 36.16, longitude: -86.78, latitudeDelta: 2, longitudeDelta: 3 }, 100],
    [{ latitude: 36.16, longitude: -86.78, latitudeDelta: 0.001, longitudeDelta: 0.001 }, 1],
    [{ latitude: 36.16, longitude: -86.78, latitudeDelta: 0, longitudeDelta: 0 }, 1],
  ])("covers the visible map within the API's 1–100 km (%j gives %d)", (region, radius) => {
    expect(radiusForRegion(region)).toBe(radius);
  });
});

describe("currentPosition on a tap", () => {
  it("asks for permission, then gives the exact point, which stays on the phone", async () => {
    expect(await currentPosition("tap")).toEqual({
      status: "found",
      point: { latitude: 36.162749, longitude: -86.781602 },
    });
    expect(permissionRequests()).toBe(1);
    // Android may offer to turn location on: the person just tapped for it.
    expect(positionOptions()).toEqual([{ accuracy: 3, mayShowUserSettingsDialog: true }]);
  });

  it("doesn't ask again once allowed (Android would offer to upgrade an approximate grant)", async () => {
    setLocationPermission("granted");
    expect(await currentPosition("tap")).toMatchObject({ status: "found" });
    expect(permissionRequests()).toBe(0);
  });

  it("reports a refusal without asking the phone where it is", async () => {
    setPermissionAnswer("denied");
    expect(await currentPosition("tap")).toEqual({ status: "denied" });
    expect(positionReads()).toBe(0);
  });

  it("treats a dismissed dialog as a refusal", async () => {
    setPermissionAnswer("dismissed");
    expect(await currentPosition("tap")).toEqual({ status: "denied" });
    expect(positionReads()).toBe(0);
  });

  it("reports a phone that can't find itself", async () => {
    setDevicePosition("fails");
    expect(await currentPosition("tap")).toEqual({ status: "unavailable" });
  });

  it("gives up on a phone that doesn't find itself within 15 seconds", async () => {
    jest.useFakeTimers(TIMEOUT_ONLY);
    setDevicePosition("hangs");
    const position = track(currentPosition("tap"));
    await jest.advanceTimersByTimeAsync(14_999);
    expect(position.settled()).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await position.result).toEqual({ status: "unavailable" });
  });
});

describe("currentPosition at launch", () => {
  it("never asks for permission, and says so when it has none", async () => {
    expect(await currentPosition("launch")).toEqual({ status: "denied" });
    expect(permissionRequests()).toBe(0);
    expect(positionReads()).toBe(0);
  });

  it("uses an earlier grant without showing any dialog", async () => {
    setLocationPermission("granted");
    expect(await currentPosition("launch")).toEqual({
      status: "found",
      point: { latitude: 36.162749, longitude: -86.781602 },
    });
    expect(permissionRequests()).toBe(0);
    expect(positionOptions()).toEqual([{ accuracy: 3, mayShowUserSettingsDialog: false }]);
  });
});

describe("locationAlreadyAllowed", () => {
  it("checks an earlier grant without asking", async () => {
    expect(await locationAlreadyAllowed()).toBe(false);
    setLocationPermission("granted");
    expect(await locationAlreadyAllowed()).toBe(true);
    expect(permissionRequests()).toBe(0);
    expect(positionReads()).toBe(0);
  });

  it("isn't fooled by a permanent refusal", async () => {
    setLocationPermission("denied");
    setCanAskAgain(false);
    expect(await locationAlreadyAllowed()).toBe(false);
  });
});

describe("findPlace", () => {
  it("asks the platform geocoder for the trimmed text", async () => {
    setPlace("Maryville, TN", { latitude: 35.7565, longitude: -83.9705 });
    expect(await findPlace("  Maryville, TN ")).toEqual({ latitude: 35.7565, longitude: -83.9705 });
    expect(lookups).toEqual(["Maryville, TN"]);
  });

  it("finds nothing for blank text without asking the geocoder", async () => {
    expect(await findPlace("   ")).toBeNull();
    expect(lookups).toEqual([]);
  });

  it("passes on the geocoder's 'not found', whether null or undefined", async () => {
    expect(await findPlace("Nowhere at all")).toBeNull();
    setPlace("Nowhere either", undefined);
    expect(await findPlace("Nowhere either")).toBeNull();
  });

  it("finds nothing when the geocoder fails", async () => {
    setGeocoderTrouble("fails");
    expect(await findPlace("Maryville, TN")).toBeNull();
  });

  it("gives up on a geocoder that doesn't answer within 15 seconds", async () => {
    jest.useFakeTimers(TIMEOUT_ONLY);
    setGeocoderTrouble("hangs");
    const place = track(findPlace("Maryville, TN"));
    await jest.advanceTimersByTimeAsync(14_999);
    expect(place.settled()).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await place.result).toBeNull();
  });

  it("clears its time limit when the geocoder answers first, so no timer is left running", async () => {
    jest.useFakeTimers(TIMEOUT_ONLY);
    setPlace("Maryville, TN", { latitude: 35.7565, longitude: -83.9705 });
    expect(await findPlace("Maryville, TN")).not.toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("treats an answer off the globe as a bug, not a place", async () => {
    setPlace("Broken", { latitude: 200, longitude: 0 });
    await expect(findPlace("Broken")).rejects.toThrow();
  });
});

describe("recent places", () => {
  it("keeps the 10 newest, newest first, ignoring case for repeats", async () => {
    // Every place is remembered in the same millisecond, so order rests on insertion alone.
    setNow("2026-09-29T12:00:00Z");
    for (let i = 1; i <= 11; i++) await rememberPlace(`Place ${String(i)}`, { latitude: 36, longitude: -86 });
    await rememberPlace("place 3", { latitude: 36, longitude: -86 });
    const labels = (await recentPlaces()).map((place) => place.label);
    expect(labels).toEqual([
      "place 3",
      "Place 11",
      "Place 10",
      "Place 9",
      "Place 8",
      "Place 7",
      "Place 6",
      "Place 5",
      "Place 4",
      "Place 2",
    ]);
  });

  it("keeps only the rounded point, which is all a later search sends", async () => {
    await rememberPlace("123 Main St, Maryville, TN", { latitude: 35.756512, longitude: -83.970498 });
    expect(await recentPlaces()).toEqual([
      { label: "123 Main St, Maryville, TN", latitude: 35.76, longitude: -83.97 },
    ]);
  });

  it("forgets them all on request", async () => {
    await rememberPlace("Maryville, TN", { latitude: 35.7565, longitude: -83.9705 });
    await forgetRecentPlaces();
    expect(await recentPlaces()).toEqual([]);
  });
});
