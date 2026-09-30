import { clockLabel } from "@/time/clock";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// When a saved copy was saved, in the phone's local time: "today at 3:40 PM", "yesterday at …", "on Sep 27 at …", or
// "on Sep 27, 2025 at …" once it's not from this year (a copy can survive long enough to cross a New Year's, however
// rare, on a phone that's been off the network).
export function savedAtLabel(savedAt: Date, now: Date): string {
  const time = clockLabel(savedAt.getHours(), savedAt.getMinutes());
  const days = Math.round((dayStart(now) - dayStart(savedAt)) / 86_400_000);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  const year = savedAt.getFullYear() === now.getFullYear() ? "" : `, ${String(savedAt.getFullYear())}`;
  return `on ${MONTHS[savedAt.getMonth()] ?? ""} ${String(savedAt.getDate())}${year} at ${time}`;
}
