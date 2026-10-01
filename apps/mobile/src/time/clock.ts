// "7:05 PM", formatted by hand so the text doesn't depend on the phone's ICU version (the app is US English).
export function clockLabel(hour: number, minute: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(twelve)}:${String(minute).padStart(2, "0")} ${suffix}`;
}

// An instant as the phone's own clock reads it, in its current time zone.
export function phoneClockLabel(instant: Date): string {
  return clockLabel(instant.getHours(), instant.getMinutes());
}
