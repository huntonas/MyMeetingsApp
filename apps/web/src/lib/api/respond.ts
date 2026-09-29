import { ApiErrorBody, ERROR_MESSAGES, type ErrorCode } from "@mymeetingapp/shared";
import type { z } from "zod";

import { logError } from "@/lib/log";

// How long the CDN may serve a copy (s-maxage), then keep serving it stale while it refetches, in seconds. null is
// never cached. Add a policy here when the first route that needs it lands.
const CACHE_POLICIES = {
  none: null,
  vocabulary: { sMaxAge: 3600, staleWhileRevalidate: 86_400 },
  config: { sMaxAge: 300, staleWhileRevalidate: 600 },
  meetingDetail: { sMaxAge: 300, staleWhileRevalidate: 600 },
  onlineMeetings: { sMaxAge: 900, staleWhileRevalidate: 3600 },
} as const;

type CachePolicy = keyof typeof CACHE_POLICIES;

function cacheControl(policy: CachePolicy): string {
  const lifetimes = CACHE_POLICIES[policy];
  if (lifetimes === null) return "no-store";
  return `public, s-maxage=${String(lifetimes.sMaxAge)}, stale-while-revalidate=${String(lifetimes.staleWhileRevalidate)}`;
}

// The longest the CDN can go on serving a meeting response (its details, or the online list with its tag counts)
// after the data behind it changed. The site's and admin notices' "the app catches up" promises are built from it.
export const MEETING_CACHE_MINUTES =
  Math.max(
    ...[CACHE_POLICIES.meetingDetail, CACHE_POLICIES.onlineMeetings].map(
      (lifetimes) => lifetimes.sMaxAge + lifetimes.staleWhileRevalidate,
    ),
  ) / 60;

const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  meeting_not_found: 404,
  server_error: 500,
  upgrade_required: 426,
  attestation_failed: 401,
  device_blocked: 403,
  too_many_tags: 400,
  unknown_tag: 400,
  tags_disabled: 403,
  window_closed: 403,
  already_tagged: 409,
  rate_limited: 429,
  not_tagged: 404,
};

// The data is parsed through its contract, so fields the contract doesn't name never leave the server.
export function jsonResponse<Schema extends z.ZodType>(
  schema: Schema,
  data: z.input<Schema>,
  cachePolicy: CachePolicy,
  status = 200,
): Response {
  return Response.json(schema.parse(data), {
    status,
    headers: { "Cache-Control": cacheControl(cachePolicy) },
  });
}

function apiError(code: ErrorCode): Response {
  return jsonResponse(
    ApiErrorBody,
    { error: { code, message: ERROR_MESSAGES[code] } },
    "none",
    ERROR_STATUS[code],
  );
}

// Throw inside withErrors for an expected failure; the client gets this code's message and nothing is logged.
export class ApiError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = "ApiError";
  }
}

// Logs only the error itself. Never log the request: its headers carry raw device IDs.
export function withErrors<Args extends unknown[]>(
  handler: (...args: Args) => Response | Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof ApiError) return apiError(error.code);
      logError("[api] unhandled error", error);
      return apiError("server_error");
    }
  };
}
