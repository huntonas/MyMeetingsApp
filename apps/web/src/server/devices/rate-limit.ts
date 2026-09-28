import { sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { type RateLimitBucket, rateLimits } from "@/db/schema";
import { ApiError } from "@/lib/api/respond";

const DAILY_LIMITS: Record<RateLimitBucket, number> = { tag_submission: 10 };

// Spec §5: counted per device per UTC day in Postgres. One statement increments only while under the limit, so
// two requests can't both take the last slot. Call it after every other check, inside the write's transaction,
// so a refused or failed write never uses up the allowance.
export async function consumeDailyLimit(
  deviceHash: string,
  bucket: RateLimitBucket,
  executor: Executor,
): Promise<void> {
  const counted = await executor.execute(sql`
    insert into ${rateLimits} (device_hash, bucket, window_start, count)
    values (${deviceHash}, ${bucket}, (now() at time zone 'utc')::date, 1)
    on conflict (device_hash, bucket, window_start) do update set count = rate_limits.count + 1
      where rate_limits.count < ${DAILY_LIMITS[bucket]}
    returning count
  `);
  if (counted.rows.length === 0) throw new ApiError("rate_limited");
}
