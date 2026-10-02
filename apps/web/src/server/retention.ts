// Spec §13: how long each kind of stored data lasts. The maintenance cron and the privacy policy both read these,
// so the policy can't state one period while the code enforces another.
export const RETENTION = {
  auditDays: 7,
  rateLimitDays: 2,
  suggestionLinkDays: 30,
  inactiveDeviceMonths: 13,
  challengeMinutes: 5,
} as const;
