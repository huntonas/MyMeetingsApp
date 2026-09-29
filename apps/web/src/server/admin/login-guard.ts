import { db } from "@/db/client";
import { isAdminAuthorization } from "@/lib/admin-auth";
import { ApiError } from "@/lib/api/respond";
import { consumeDailyLimit, dailyLimitReached } from "@/server/devices/rate-limit";

// One site-wide count (owner decision 2): a sign-in attempt stores no device, IP address or username (spec §2).
// A Vercel Firewall rule on /metrics limits each visitor, so the app never stores an IP; this count is only a
// backstop of 200 failed sign-ins a UTC day.
const LOGIN_KEY = "metrics-login";

// Spec §10. A browser's first request carries no credentials; it gets the sign-in prompt and isn't a failure.
// Once today's failures reach the backstop, every attempt is refused before the credentials are compared, the
// right ones included, so guessing can't go on.
export async function checkAdminLogin(
  authorization: string | null,
): Promise<"allowed" | "denied" | "locked"> {
  if (authorization === null) return "denied";
  if (await dailyLimitReached(LOGIN_KEY, "metrics_login", db)) return "locked";
  if (isAdminAuthorization(authorization)) return "allowed";
  try {
    await consumeDailyLimit(LOGIN_KEY, "metrics_login", db);
  } catch (error) {
    if (error instanceof ApiError) return "locked";
    throw error;
  }
  return "denied";
}
