import tzlookup from "@photostructure/tz-lookup";

// Spec §3: the time zone comes from the feed when given, otherwise from the coordinates (an offline lookup).
export function zoneAt(latitude: number, longitude: number): string {
  return tzlookup(latitude, longitude);
}
