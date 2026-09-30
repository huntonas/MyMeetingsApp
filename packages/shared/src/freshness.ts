// How long the CDN may serve a copy of each cacheable API response (s-maxage), then keep serving it stale while it
// refetches (stale-while-revalidate), in seconds. The API's Cache-Control headers are built from these, the website's
// "the app catches up within …" promises are worked out from them, and the app reuses its own copies only for what
// the promise has left (owner decision 5, 2026-09-29). Change a lifetime here and all three follow.
export const CDN_LIFETIMES = {
  vocabulary: { sMaxAge: 3600, staleWhileRevalidate: 86_400 },
  config: { sMaxAge: 300, staleWhileRevalidate: 600 },
  meetingDetail: { sMaxAge: 300, staleWhileRevalidate: 600 },
  onlineMeetings: { sMaxAge: 900, staleWhileRevalidate: 3600 },
} as const;

export type CdnCachedResponse = keyof typeof CDN_LIFETIMES;

export function cdnStaleMinutes(response: CdnCachedResponse): number {
  const lifetimes = CDN_LIFETIMES[response];
  return (lifetimes.sMaxAge + lifetimes.staleWhileRevalidate) / 60;
}

// The sync-feeds cron's interval in apps/web/vercel.ts (apps/web/test/catch-up.test.tsx fails if the two differ).
const SYNC_INTERVAL_MINUTES = 15;

const MEETING_MINUTES = Math.max(cdnStaleMinutes("meetingDetail"), cdnStaleMinutes("onlineMeetings"));

// Worst cases the website promises. A change on our server (tags turned off, counts after "Delete all my tags")
// reaches the app once cached meeting responses expire; a feed opt-out waits for the next sync first.
export const CATCH_UP_MINUTES = {
  app: MEETING_MINUTES,
  feedOptOut: SYNC_INTERVAL_MINUTES + MEETING_MINUTES,
} as const;

// The same for the tag list, which the admin notices about new, retired and restored tags promise.
export const VOCABULARY_CATCH_UP_HOURS = cdnStaleMinutes("vocabulary") / 60;
