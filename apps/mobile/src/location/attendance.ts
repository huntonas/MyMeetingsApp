import NativeLocation from "@modules/native-location";
import * as Location from "expo-location";
import { z } from "zod";

import { appPlatform } from "@/config/app-version";
import { distanceKm, type LatLng } from "@/location/geo";
import { withinTimeLimit } from "@/location/time-limit";

export type AttendanceAnswer = "near" | "notNear" | "denied" | "approximate" | "unavailable";

// Spec §8: within 200 m, plus the fix's own accuracy, but never more than 500 m.
const NEAR_METERS = 200;
const MOST_METERS = 500;
// app.config.ts: ios.infoPlist.NSLocationTemporaryUsageDescriptionDictionary.
const ATTENDANCE_PURPOSE_KEY = "AttendanceCheck";

const precise = (permission: Location.LocationPermissionResponse) =>
  appPlatform() === "android"
    ? permission.android?.accuracy === "fine"
    : permission.ios?.accuracy !== "reduced";

// "open": a meeting page opening by itself, with no dialog of any kind (spec §2). "tap": the person asked for the
// check, so permission, and then precise location (Android) or temporary full accuracy (iOS), may be asked for.
async function preciseAccess(when: "tap" | "open"): Promise<"precise" | "approximate" | "denied"> {
  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) {
    if (when === "open") return "denied";
    permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return "denied";
  }
  if (precise(permission)) return "precise";
  if (when === "open") return "approximate";
  // Asked again with only approximate location, Android offers to make it precise.
  if (appPlatform() === "android")
    return precise(await Location.requestForegroundPermissionsAsync()) ? "precise" : "approximate";
  const full = z.boolean().parse(await NativeLocation.requestTemporaryFullAccuracy(ATTENDANCE_PURPOSE_KEY));
  return full ? "precise" : "approximate";
}

// Spec §2: the proximity check runs on the phone. The position is used here and dropped; only the answer leaves. A
// native call that fails (location services off, a permission request that errors) is "unavailable", like a fix that
// never comes.
export async function checkAttendance(place: LatLng, when: "tap" | "open"): Promise<AttendanceAnswer> {
  try {
    const access = await preciseAccess(when);
    if (access !== "precise") return access;
    const { coords } = await withinTimeLimit(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: when === "tap",
      }),
    );
    const meters = distanceKm(place, coords) * 1000;
    return meters <= Math.min(NEAR_METERS + (coords.accuracy ?? 0), MOST_METERS) ? "near" : "notNear";
  } catch {
    return "unavailable";
  }
}
