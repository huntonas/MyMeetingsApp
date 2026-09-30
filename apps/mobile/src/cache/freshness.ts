import { CATCH_UP_MINUTES, cdnStaleMinutes, VOCABULARY_CATCH_UP_HOURS } from "@mymeetingapp/shared";

// How long the app may keep showing its own copy without asking again. The CDN may already have held that copy for
// as long as cdnStaleMinutes, so the two together never pass what the website promises: tag changes and opt-outs
// reach the app within CATCH_UP_MINUTES.app, and tag-list changes within VOCABULARY_CATCH_UP_HOURS (owner decision 5,
// 2026-09-29). /config is read at every launch.
//
// Not exported: every current consumer goes through CacheKind and isFresh below. Export it, alongside its own
// consumer, the day something needs the raw minutes (docs/standards.md, "one way").
const REUSE_MINUTES = {
  // A POST, never cached by the CDN.
  search: CATCH_UP_MINUTES.app,
  meetingDetail: CATCH_UP_MINUTES.app - cdnStaleMinutes("meetingDetail"),
  onlineMeetings: CATCH_UP_MINUTES.app - cdnStaleMinutes("onlineMeetings"),
  vocabulary: VOCABULARY_CATCH_UP_HOURS * 60 - cdnStaleMinutes("vocabulary"),
  config: 0,
} as const;

export type CacheKind = keyof typeof REUSE_MINUTES;

export function isFresh(kind: CacheKind, savedAt: Date, now: Date): boolean {
  return now.getTime() - savedAt.getTime() < REUSE_MINUTES[kind] * 60_000;
}
