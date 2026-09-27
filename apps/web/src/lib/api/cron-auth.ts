import { createHash, timingSafeEqual } from "node:crypto";

import { readEnv } from "@/env";
import { ApiError } from "@/lib/api/respond";

const digest = (value: string) => createHash("sha256").update(value).digest();

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without a configured secret, nothing gets in.
export function assertCronRequest(req: Request): void {
  const secret = readEnv("CRON_SECRET");
  const header = req.headers.get("authorization") ?? "";
  if (secret === undefined || !timingSafeEqual(digest(header), digest(`Bearer ${secret}`))) {
    throw new ApiError("unauthorized");
  }
}
