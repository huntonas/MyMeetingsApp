import { and, eq, type SQL, sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { type RateLimitBucket, rateLimits } from "@/db/schema";
import { utcToday } from "@/db/sql";
import { ApiError } from "@/lib/api/respond";

// metrics_login is the site-wide backstop for /metrics sign-ins (spec §10). attestation counts App Attest challenges:
// a phone needs one per install, more only after Delete all my tags or a lost key.
const DAILY_LIMITS: Record<Exclude<RateLimitBucket, "attestation_site">, number> = {
  tag_submission: 10,
  suggestion: 5,
  metrics_login: 200,
  attestation: 10,
};

// attestation_site: App Attest challenges across the whole site in one UTC hour, whichever phone asks. A client can
// invent device IDs, so this is the backstop the per-phone limit can't be (owner decision, 2026-10-04, in place of a
// paid Vercel Firewall rule).
const SITE_CHALLENGES_PER_HOUR = 1000;

// Spec §5: counted in Postgres. One statement increments only while under the limit, so two requests can't both take
// the last slot. Call it after every other check, inside the write's transaction, so a refused or failed write never
// uses up the allowance.
async function consumeLimit(
  key: SQL | string,
  bucket: RateLimitBucket,
  limit: number,
  executor: Executor,
): Promise<void> {
  const counted = await executor.execute(sql`
    insert into ${rateLimits} (device_hash, bucket, window_start, count)
    values (${key}, ${bucket}, ${utcToday}, 1)
    on conflict (device_hash, bucket, window_start) do update set count = rate_limits.count + 1
      where rate_limits.count < ${limit}
    returning count
  `);
  if (counted.rows.length === 0) throw new ApiError("rate_limited");
}

// Per UTC day. key is a device hash, or "metrics-login" for the site-wide sign-in count.
export async function consumeDailyLimit(
  key: string,
  bucket: keyof typeof DAILY_LIMITS,
  executor: Executor,
): Promise<void> {
  await consumeLimit(key, bucket, DAILY_LIMITS[bucket], executor);
}

// One count for the site, with no device, IP address or user: today's row under the current UTC hour's key.
export async function consumeSiteChallenge(executor: Executor): Promise<void> {
  const hourKey = sql`'attestation-site-' || to_char(now() at time zone 'utc', 'HH24')`;
  await consumeLimit(hourKey, "attestation_site", SITE_CHALLENGES_PER_HOUR, executor);
}

// Whether today's allowance is already used up, without using any of it. For a caller that must refuse before
// doing the work a failure would count: admin sign-in compares credentials only while under the limit.
export async function dailyLimitReached(
  key: string,
  bucket: keyof typeof DAILY_LIMITS,
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
