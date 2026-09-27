import { ApiErrorBody, ERROR_MESSAGES, type ErrorCode } from "@mymeetingapp/shared";
import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";
import type { z } from "zod";

// Add a policy here when the first route that needs it lands.
const CACHE_POLICIES = {
  none: "no-store",
  vocabulary: "public, s-maxage=3600, stale-while-revalidate=86400",
  config: "public, s-maxage=300, stale-while-revalidate=600",
  meetingDetail: "public, s-maxage=300, stale-while-revalidate=600",
  onlineMeetings: "public, s-maxage=900, stale-while-revalidate=3600",
} as const;

type CachePolicy = keyof typeof CACHE_POLICIES;

const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  meeting_not_found: 404,
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

// Query parameters can carry coordinates and device IDs. Drizzle puts them in its error message, and the
// database's own message can quote an offending value, so for database errors only the SQL text and the
// database's structured fields are logged.
function describeError(error: unknown): string {
  if (error instanceof DrizzleQueryError) {
    return `database query failed: ${error.query}\ncaused by: ${describeError(error.cause)}`;
  }
  if (error instanceof DatabaseError) {
    const { code, severity, constraint, table, column, routine } = error;
    return `database error ${JSON.stringify({ code, severity, constraint, table, column, routine })}`;
  }
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
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
      console.error("[api] unhandled error:", describeError(error));
      return apiError("server_error");
    }
  };
}
