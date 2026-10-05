import { ApiError, Unreachable } from "@/api/client";
import { AppleUnreachable } from "@/device/app-integrity";

// Anything else (a bug, a native module throwing) is ours, not the server's or the connection's; say so plainly
// instead of leaving the screen on "Loading" forever.
export const GENERIC_FAILURE = "Something went wrong on this phone. Try again.";

// The server wanted a proof the phone couldn't make because Apple was out of reach. Its own words would say to update
// the app, which wouldn't help.
const APPLE_UNREACHABLE = "We couldn't reach Apple to confirm this request. Try again in a moment.";

// A read or write that didn't go through, in plain words. The server's refusals come with its own message (spec §7);
// `unreachable` says what the caller couldn't finish, since a timed-out write may still have reached the server.
export function failureMessage(error: unknown, unreachable: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Unreachable) return unreachable;
  if (error instanceof AppleUnreachable) return APPLE_UNREACHABLE;
  return GENERIC_FAILURE;
}
