import * as Location from "expo-location";

import type { LatLng } from "@/location/geo";
import { withinTimeLimit } from "@/location/time-limit";

export type PositionResult =
  { status: "found"; point: LatLng } | { status: "denied" } | { status: "unavailable" };

// Spec §2: While Using permission, asked for only when the person taps "Use my location", never at launch, never in
// the background. The exact point stays on the phone; only roundForSearch's rounding of it is ever sent.
//
// - "tap": the person asked. The permission dialog appears if permission isn't granted yet, and Android may offer to
//   turn location on. It never asks again once granted: on Android that would offer to upgrade an approximate grant.
// - "launch": a screen opening by itself. No dialog of any kind; without an earlier grant the answer is "denied".
export async function currentPosition(when: "tap" | "launch"): Promise<PositionResult> {
  const allowed =
    (await locationAlreadyAllowed()) ||
    (when === "tap" && (await Location.requestForegroundPermissionsAsync()).granted);
  if (!allowed) return { status: "denied" };
  try {
    const position = await withinTimeLimit(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        mayShowUserSettingsDialog: when === "tap",
      }),
    );
    return {
      status: "found",
      point: { latitude: position.coords.latitude, longitude: position.coords.longitude },
    };
  } catch {
    return { status: "unavailable" };
  }
}

// Permission granted on an earlier tap: Nearby may start near the person without asking again (decision 10).
export async function locationAlreadyAllowed(): Promise<boolean> {
  return (await Location.getForegroundPermissionsAsync()).granted;
}
