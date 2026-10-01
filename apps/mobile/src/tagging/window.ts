import type { MeetingSummary } from "@mymeetingapp/shared";

import type { LatLng } from "@/location/geo";
import { lastOccurrence, type Occurrence, occurrenceEnd, type Scheduled } from "@/meetings/schedule";
import { DAY_MS, MINUTE_MS } from "@/time/civil-date";

// Spec §5: new submissions from the most recent start until 36 hours later, and one per meeting every 7 days. The
// phone decides only what to offer from these; the server's answer (window_closed, already_tagged) always wins.
export const TAGGING_WINDOW_MS = 36 * 60 * MINUTE_MS;

// lastOccurrence resolves the start in the meeting's own zone as Postgres's AT TIME ZONE does, so the window opens
// and closes at the same instants as the server's taggingWindowOpen.
export function taggingOpen(meeting: Scheduled, now: Date): boolean {
  const start = lastOccurrence(meeting, now).start.getTime();
  return now.getTime() >= start && now.getTime() < start + TAGGING_WINDOW_MS;
}

// A record stamped later than now was made before the phone's clock moved back; counting it would hide tagging for
// longer than the server's week.
export function confirmedThisWeek(confirmedAt: Date, now: Date): boolean {
  const age = now.getTime() - confirmedAt.getTime();
  return age >= 0 && age < 7 * DAY_MS;
}

const CHECK_EARLY_MS = 15 * MINUTE_MS;
const CHECK_LATE_MS = 30 * MINUTE_MS;

// Spec §8: a meeting's time for the attendance check is 15 minutes before its start to 30 minutes after its end, or
// 90 minutes after the start when it has no end time (occurrenceEnd counts that meeting as an hour long). The
// occurrence whose time contains `now`, or null. Its start is the one taggingOpen counts from once the meeting has
// begun, so a result kept for it is the one a submission reads.
export function attendanceOccurrence(meeting: Scheduled, now: Date): Occurrence | null {
  const occurrence = lastOccurrence(meeting, new Date(now.getTime() + CHECK_EARLY_MS));
  const until = occurrenceEnd(meeting, occurrence).getTime() + CHECK_LATE_MS;
  return now.getTime() < until ? occurrence : null;
}

// Where an attendance check can look: an in-person or hybrid meeting with a map point. An online meeting has nowhere
// to be near, even when its listing gives a point.
export function checkablePlace(meeting: MeetingSummary): LatLng | null {
  if (meeting.attendance === "online" || meeting.latitude === null || meeting.longitude === null) return null;
  return { latitude: meeting.latitude, longitude: meeting.longitude };
}
