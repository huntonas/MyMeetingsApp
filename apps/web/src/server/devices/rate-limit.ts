import { and, eq, sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { type RateLimitBucket, rateLimits } from "@/db/schema";
import { utcToday } from "@/db/sql";
import { ApiError } from "@/lib/api/respond";

// metrics_login is the site-wide backstop for /metrics sign-ins (spec §10); a Vercel Firewall rule limits each
// visitor.
const DAILY_LIMITS: Record<RateLimitBucket, number> = {
  tag_submission: 10,
  suggestion: 5,
  metrics_login: 200,
};

// key is a device hash, or "metrics-login" for the site-wide sign-in count.
// Spec §5: counted per device per UTC day in Postgres. One statement increments only while under the limit, so
// two requests can't both take the last slot. Call it after every other check, inside the write's transaction,
// so a refused or failed write never uses up the allowance.
export async function consumeDailyLimit(
  key: string,
  bucket: RateLimitBucket,
  executor: Executor,
): Promise<void> {
  const counted = await executor.execute(sql`
    insert into ${rateLimits} (device_hash, bucket, window_start, count)
    values (${key}, ${bucket}, ${utcToday}, 1)
    on conflict (device_hash, bucket, window_start) do update set count = rate_limits.count + 1
      where rate_limits.count < ${DAILY_LIMITS[bucket]}
    returning count
  `);
  if (counted.rows.length === 0) throw new ApiError("rate_limited");
}

// Whether today's allowance is already used up, without using any of it. For a caller that must refuse before
// doing the work a failure would count: admin sign-in compares credentials only while under the limit.
export async function dailyLimitReached(
  key: string,
  bucket: RateLimitBucket,
  executor: Executor,
): Promise<boolean> {
  const [row] = await executor
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(
      and(
        eq(rateLimits.deviceHash, key),
        eq(rateLimits.bucket, bucket),
        eq(rateLimits.windowStart, utcToday),
      ),
    );
  return (row?.count ?? 0) >= DAILY_LIMITS[bucket];
}
