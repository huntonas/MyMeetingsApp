import { readEnv } from "@/env";
import { ApiError } from "@/lib/api/respond";
import { constantTimeEqual } from "@/lib/constant-time";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without a configured secret, nothing gets in.
export function assertCronRequest(req: Request): void {
  const secret = readEnv("CRON_SECRET");
  const header = req.headers.get("authorization") ?? "";
  if (secret === undefined || !constantTimeEqual(header, `Bearer ${secret}`)) {
    throw new ApiError("unauthorized");
  }
}
