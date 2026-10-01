import { ApiError, Unreachable } from "@/api/client";
import { GENERIC_FAILURE } from "@/cache/use-cached-read";

// A write that didn't go through, in plain words. The server's refusals come with its own message (spec §7);
// `offline` says what the caller couldn't finish, since a timed-out write may still have reached the server.
export function writeFailure(error: unknown, offline: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Unreachable) return offline;
  return GENERIC_FAILURE;
}
