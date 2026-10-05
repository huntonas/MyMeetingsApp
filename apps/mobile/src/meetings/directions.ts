import type { V1MeetingSummary } from "@mymeetingapp/shared";

// Spec §8: directions hand off to Apple Maps or Google Maps, which start from the phone's own location; the app sends
// only the meeting's place, never the person's (spec §2). Coordinates when both are known, else the address.
export function directionsUrl(
  meeting: Pick<V1MeetingSummary, "latitude" | "longitude" | "formattedAddress">,
  platform: "ios" | "android",
): string | null {
  const destination =
    meeting.latitude !== null && meeting.longitude !== null
      ? `${String(meeting.latitude)},${String(meeting.longitude)}`
      : meeting.formattedAddress;
  if (destination === null) return null;
  const encoded = encodeURIComponent(destination);
  return platform === "ios"
    ? `https://maps.apple.com/?daddr=${encoded}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
}
