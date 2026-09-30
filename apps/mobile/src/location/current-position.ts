import * as Location from "expo-location";

import type { LatLng } from "@/location/geo";

export type PositionResult =
  { status: "found"; point: LatLng } | { status: "denied" } | { status: "unavailable" };

// Spec §2: While Using permission, asked only when the person taps "Use my location": never at launch, never in the
// background. The exact point stays on the phone; only roundForSearch's rounding of it is ever sent.
export async function currentPosition(): Promise<PositionResult> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return { status: "denied" };
  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
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
