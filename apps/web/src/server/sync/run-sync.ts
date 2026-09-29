import { createHostThrottle, type HostThrottle } from "@mymeetingapp/feed-kit";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Client } from "pg";
import { z } from "zod";

import { db } from "@/db/client";
import { directDatabaseUrl } from "@/db/connection-url";
import { feedMeetings, feeds } from "@/db/schema";
import { logError } from "@/lib/log";
import { fetchFeed } from "@/server/feeds/fetch-feed";
import { FeedFormatError, normalizeFeed } from "@/server/feeds/normalize";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";
import { geocodePendingAddresses } from "@/server/meetings/geocode";
import { recomputeMeetings } from "@/server/meetings/recompute";

export const SyncSummary = z.object({
  status: z.enum(["done", "locked"]),
  synced: z.number().int(),
  unchanged: z.number().int(),
  failed: z.number().int(),
  geocoded: z.number().int(),
});
export type SyncSummary = z.infer<typeof SyncSummary>;

const LOCK_KEY = 7_202_609; // arbitrary constant naming the feed-sync advisory lock
// Spec §4 good-citizen rules: each feed is fetched at most once a week, and a failing one is retried daily.
const SUCCESS_INTERVAL = sql`interval '7 days'`;
const RETRY_INTERVAL = sql`interval '1 day'`;
const SHRINK_GUARD_MINIMUM = 20;

// A feed that has gone longer than this without a success has missed its weekly sync and its retry (owner decision
// 1; /metrics shows it). Parenthesized so it stays 8 days wherever it's substituted after a `-`: without the
// parentheses, `now() - a + b` reads as `(now() - a) + b`, not `now() - (a + b)`.
export const FEED_OVERDUE_AFTER = sql`(${SUCCESS_INTERVAL} + ${RETRY_INTERVAL})`;

type Feed = typeof feeds.$inferSelect;
type Outcome = "synced" | "unchanged" | "failed";

async function recordFailure(feed: Feed, message: string): Promise<Outcome> {
  await db.update(feeds).set({ lastError: message }).where(eq(feeds.id, feed.id));
  return "failed";
}

async function syncFeed(feed: Feed, throttle: HostThrottle): Promise<Outcome> {
  await db.update(feeds).set({ lastAttemptAt: new Date() }).where(eq(feeds.id, feed.id));
  const fetched = await fetchFeed(feed.url, { etag: feed.etag, lastModified: feed.lastModified }, throttle);
  if (fetched.kind === "error") return recordFailure(feed, fetched.message);
  if (fetched.kind === "not_modified") {
    await db.update(feeds).set({ lastSuccessAt: new Date(), lastError: null }).where(eq(feeds.id, feed.id));
    return "unchanged";
  }

  let rows;
  try {
    rows = normalizeFeed(fetched.body).meetings;
  } catch (error) {
    if (error instanceof FeedFormatError) return recordFailure(feed, error.message);
    throw error;
  }
  // Spec §3: a feed hiccup must not archive meetings (and their tag history) wholesale.
  const previous = feed.meetingCount ?? 0;
  if (previous >= SHRINK_GUARD_MINIMUM && rows.length < previous / 2) {
    return recordFailure(
      feed,
      `meeting count dropped from ${String(previous)} to ${String(rows.length)}; not applied`,
    );
  }

  await applyFeedSnapshot(feed.id, rows);
  await db
    .update(feeds)
    .set({
      lastSuccessAt: new Date(),
      lastError: null,
      meetingCount: rows.length,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
    })
    .where(eq(feeds.id, feed.id));
  return "synced";
}

// Clearing the validators and count means a feed that opts back in is fetched in full, even if it would answer 304.
async function archiveOptedOutFeeds(): Promise<void> {
  await db
    .update(feeds)
    .set({ etag: null, lastModified: null, meetingCount: null })
    .where(eq(feeds.optedOut, true));
  const archived = await db
    .update(feedMeetings)
    .set({ archivedAt: new Date() })
    .where(
      and(
        isNull(feedMeetings.archivedAt),
        inArray(feedMeetings.feedId, db.select({ id: feeds.id }).from(feeds).where(eq(feeds.optedOut, true))),
      ),
    )
    .returning({ meetingId: feedMeetings.meetingId });
  await recomputeMeetings([...new Set(archived.map((row) => row.meetingId))]);
}

async function dueFeeds(): Promise<Feed[]> {
  return db
    .select()
    .from(feeds)
    .where(
      and(
        eq(feeds.optedOut, false),
        or(isNull(feeds.lastSuccessAt), lt(feeds.lastSuccessAt, sql`now() - ${SUCCESS_INTERVAL}`)),
        or(isNull(feeds.lastAttemptAt), lt(feeds.lastAttemptAt, sql`now() - ${RETRY_INTERVAL}`)),
      ),
    )
    .orderBy(sql`${feeds.lastSuccessAt} nulls first`, feeds.id);
}

// Spec §3: stalest feeds first, stop starting new ones when the budget is spent, one failure never stops the rest.
// The advisory lock is session-level, so it needs a direct connection: pool's DATABASE_URL is Neon's
// PgBouncer (transaction mode) pooler in production, where lock and unlock can land on different backends.
export async function runSync(budgetMs: number): Promise<SyncSummary> {
  const deadline = Date.now() + budgetMs;
  const lockClient = new Client({ connectionString: directDatabaseUrl() });
  // An idle client emits 'error' when its session drops; unhandled, that would crash the process.
  lockClient.on("error", (error) => {
    logError("[sync] lock session error", error);
  });
  await lockClient.connect();
  try {
    const { rows } = await lockClient.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [LOCK_KEY],
    );
    if (rows[0]?.locked !== true)
      return { status: "locked", synced: 0, unchanged: 0, failed: 0, geocoded: 0 };
    try {
      await archiveOptedOutFeeds();
      const counts: Record<Outcome, number> = { synced: 0, unchanged: 0, failed: 0 };
      const throttle = createHostThrottle();
      for (const feed of await dueFeeds()) {
        if (Date.now() >= deadline) break;
        let outcome: Outcome;
        try {
          outcome = await syncFeed(feed, throttle);
        } catch (error) {
          logError(`[sync] feed ${String(feed.id)} failed`, error);
          outcome = await recordFailure(feed, "sync failed; see logs");
        }
        counts[outcome] += 1;
      }
      const geocoded = await geocodePendingAddresses(throttle, deadline);
      return { status: "done", ...counts, geocoded };
    } finally {
      await lockClient.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    // Ending the session also frees the lock if the unlock above failed.
    await lockClient.end();
  }
}
