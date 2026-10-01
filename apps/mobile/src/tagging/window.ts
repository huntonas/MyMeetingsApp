import { lastOccurrence, type Scheduled } from "@/meetings/schedule";
import { DAY_MS, MINUTE_MS } from "@/time/civil-date";

// Spec §5: new submissions from the most recent start until 36 hours later, and one per meeting every 7 days. The
// phone decides only what to offer from these; the server's answer (window_closed, already_tagged) always wins.
const TAGGING_WINDOW_MS = 36 * 60 * MINUTE_MS;

// lastOccurrence resolves the start in the meeting's own zone as Postgres's AT TIME ZONE does, so the window opens
// and closes at the same instants as the server's taggingWindowOpen.
export function taggingOpen(meeting: Scheduled, now: Date): boolean {
  const start = lastOccurrence(meeting, now).start.getTime();
  return now.getTime() >= start && now.getTime() < start + TAGGING_WINDOW_MS;
}

export function confirmedThisWeek(confirmedAt: Date, now: Date): boolean {
  return now.getTime() - confirmedAt.getTime() < 7 * DAY_MS;
}
