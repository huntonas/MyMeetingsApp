import type { MeetingSummary } from "@mymeetingapp/shared";

import { lastOccurrence, nextStart, occurrenceEnd } from "@/meetings/schedule";

export interface TimedMeeting {
  meeting: MeetingSummary;
  start: Date;
}

const SOON_MINUTES = 120;

const byStart = (a: TimedMeeting, b: TimedMeeting) =>
  a.start.getTime() - b.start.getTime() || a.meeting.name.localeCompare(b.meeting.name);

// Spec §8 "Online now": meetings in progress, plus those starting within two hours. A meeting without a time zone
// can't be placed in time, so it's left out.
export function onlineNow(
  meetings: MeetingSummary[],
  now: Date,
): { happening: TimedMeeting[]; soon: TimedMeeting[] } {
  const happening: TimedMeeting[] = [];
  const soon: TimedMeeting[] = [];
  for (const meeting of meetings) {
    if (meeting.timezone === null) continue;
    const scheduled = { ...meeting, timezone: meeting.timezone };
    const occurrence = lastOccurrence(scheduled, now);
    if (now.getTime() < occurrenceEnd(scheduled, occurrence).getTime()) {
      happening.push({ meeting, start: occurrence.start });
      continue;
    }
    const next = nextStart(scheduled, now);
    if (next.getTime() - now.getTime() <= SOON_MINUTES * 60_000) soon.push({ meeting, start: next });
  }
  return { happening: happening.sort(byStart), soon: soon.sort(byStart) };
}
