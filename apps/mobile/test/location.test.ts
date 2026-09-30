import { MeetingSearchRequest } from "@mymeetingapp/shared";

import { currentPosition, locationAlreadyAllowed } from "@/location/current-position";
import { findPlace } from "@/location/find-place";
import { distanceKm, radiusForRegion, roundForSearch } from "@/location/geo";
import { forgetRecentPlaces, recentPlaces, rememberPlace } from "@/location/recent-places";

import { resetAppData } from "./app-data";
import {
  permissionRequests,
  positionReads,
  setDevicePosition,
  setLocationPermission,
  setPermissionAnswer,
} from "./native/expo-location";
import { lookups, setPlace } from "./native/native-location";

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

describe("currentPosition", () => {
  it("asks for permission, then gives the exact point, which stays on the phone", async () => {
    expect(await currentPosition()).toEqual({
      status: "found",
      point: { latitude: 36.162749, longitude: -86.781602 },
    });
    expect(permissionRequests()).toBe(1);
  });

  it("reports a refusal without asking the phone where it is", async () => {
    setPermissionAnswer("denied");
    expect(await currentPosition()).toEqual({ status: "denied" });
    expect(positionReads()).toBe(0);
  });

  it("reports a phone that can't find itself", async () => {
    setDevicePosition("fails");
    expect(await currentPosition()).toEqual({ status: "unavailable" });
  });

  it("checks an earlier grant without asking", async () => {
    expect(await locationAlreadyAllowed()).toBe(false);
    setLocationPermission("granted");
    expect(await locationAlreadyAllowed()).toBe(true);
    expect(permissionRequests()).toBe(0);
    expect(positionReads()).toBe(0);
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

  it("passes on the geocoder's 'not found'", async () => {
    expect(await findPlace("Nowhere at all")).toBeNull();
  });

  it("treats an answer off the globe as a bug, not a place", async () => {
    setPlace("Broken", { latitude: 200, longitude: 0 });
    await expect(findPlace("Broken")).rejects.toThrow();
  });
});

describe("recent places", () => {
  it("keeps the 10 newest, newest first, ignoring case for repeats", async () => {
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
