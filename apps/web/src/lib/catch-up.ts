import { MEETING_CACHE_MINUTES } from "@/lib/api/respond";

// The sync-feeds cron's interval in vercel.ts (catch-up.test.tsx fails if the two differ).
const SYNC_INTERVAL_MINUTES = 15;

// Worst cases, in minutes, for what the site and admin notices promise. A change on our server (tags turned off,
// counts after "Delete all my tags") reaches the app once cached meeting responses expire. A feed opt-out waits for
// the next sync first.
export const CATCH_UP_MINUTES = {
  app: MEETING_CACHE_MINUTES,
  feedOptOut: SYNC_INTERVAL_MINUTES + MEETING_CACHE_MINUTES,
} as const;
