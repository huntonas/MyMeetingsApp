export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface MapRegion extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

const KM_PER_DEGREE = 111.32;
const EARTH_RADIUS_KM = 6371.0088;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

// Spec §2: the phone rounds to 2 decimal places (about 1 km) before anything leaves it. The server refuses anything
// finer (MeetingSearchRequest).
export function roundForSearch(point: LatLng): LatLng {
  return {
    latitude: Math.round(point.latitude * 100) / 100,
    longitude: Math.round(point.longitude * 100) / 100,
  };
}

// Spec §8: the phone re-sorts by exact distance from the real point, which never leaves it.
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// Spec §8 "radius from the visible area": half the map's diagonal, in whole km, within the API's 1–100.
export function radiusForRegion(region: MapRegion): number {
  const halfHeight = (region.latitudeDelta / 2) * KM_PER_DEGREE;
  const halfWidth = (region.longitudeDelta / 2) * KM_PER_DEGREE * Math.cos(toRadians(region.latitude));
  return Math.min(100, Math.max(1, Math.ceil(Math.hypot(halfHeight, halfWidth))));
}
