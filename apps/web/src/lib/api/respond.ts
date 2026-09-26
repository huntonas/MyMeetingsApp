import { ApiErrorBody, ERROR_MESSAGES, type ErrorCode } from "@mymeetingapp/shared";
import type { z } from "zod";

// Add a policy here when the first route that needs it lands.
const CACHE_POLICIES = {
  none: "no-store",
} as const;

type CachePolicy = keyof typeof CACHE_POLICIES;

const ERROR_STATUS: Record<ErrorCode, number> = {
  server_error: 500,
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
    headers: { "Cache-Control": CACHE_POLICIES[cachePolicy] },
  });
}

export function apiError(code: ErrorCode): Response {
  return jsonResponse(
    ApiErrorBody,
    { error: { code, message: ERROR_MESSAGES[code] } },
    "none",
    ERROR_STATUS[code],
  );
}

// Logs only the error itself. Never log the request: its headers carry raw device IDs.
export function withErrors<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error(
        "[api] unhandled error:",
        error instanceof Error ? (error.stack ?? error.message) : error,
      );
      return apiError("server_error");
    }
  };
}
