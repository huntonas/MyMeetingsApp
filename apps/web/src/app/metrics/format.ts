// Admin pages show times in UTC, the zone the metrics and the maintenance cron count days in.
export function utcTime(value: Date | null): string {
  return value === null ? "never" : `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
