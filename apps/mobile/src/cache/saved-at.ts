import { civilDateOf, daysBetween, MONTHS_SHORT } from "@/time/civil-date";
import { clockLabel } from "@/time/clock";

// When a saved copy was saved, in the phone's local time: "today at 3:40 PM", "yesterday at …", "on Sep 27 at …", or
// "on Sep 27, 2025 at …" once it's not from this year (a copy can survive long enough to cross a New Year's, however
// rare, on a phone that's been off the network).
export function savedAtLabel(savedAt: Date, now: Date): string {
  const time = clockLabel(savedAt.getHours(), savedAt.getMinutes());
  const days = daysBetween(civilDateOf(savedAt), civilDateOf(now));
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  const year = savedAt.getFullYear() === now.getFullYear() ? "" : `, ${String(savedAt.getFullYear())}`;
  return `on ${MONTHS_SHORT[savedAt.getMonth()] ?? ""} ${String(savedAt.getDate())}${year} at ${time}`;
}
