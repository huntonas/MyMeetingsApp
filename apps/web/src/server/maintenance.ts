import { and, eq, isNotNull, lt, notExists, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { deviceCheckTokens, deviceDays, devices, rateLimits, suggestions, tagAudit } from "@/db/schema";
import { utcToday } from "@/db/sql";
import { deleteExpiredChallenges } from "@/server/attest/challenges";
import { foldDeviceDays } from "@/server/devices/device-days";
import { RETENTION } from "@/server/retention";
import { recountAllTags } from "@/server/tags/counts";

export const MaintenanceSummary = z.object({
  meetingsWithTags: z.number().int(),
  auditRowsPurged: z.number().int(),
  rateLimitRowsPurged: z.number().int(),
  suggestionsUnlinked: z.number().int(),
  devicesPurged: z.number().int(),
  challengesPurged: z.number().int(),
  devicesFolded: z.number().int(),
  deviceDaysPurged: z.number().int(),
  deviceCheckTokensPurged: z.number().int(),
});
export type MaintenanceSummary = z.infer<typeof MaintenanceSummary>;

// Spec §5, §6 and §13, nightly and idempotent: folds the days devices wrote into their records first
// (foldDeviceDays), then enforces each retention limit, then rebuilds every count. Blocked devices are exempt from
// the 13-month purge: blocking is a standing decision the owner made, and even delete-mine can't undo it, so the row
// must outlive inactivity too.
// The purges commit before the rebuild starts, so the rebuild never waits for its EXCLUSIVE lock on tag_counts (see
// recountAllTags) while holding rows a tag write or merge will want: every one of those takes tag_counts last,
// after rows like the audit rows purged here, and holding both would let the two wait on each other in a cycle.
export async function runMaintenance(): Promise<MaintenanceSummary> {
  // Before the purge, so a purged day has always been folded first; if the fold throws, nothing is purged.
  const devicesFolded = await foldDeviceDays();
  const purges = await db.transaction(async (tx) => {
    const audit = await tx
      .delete(tagAudit)
      .where(lt(tagAudit.at, sql`now() - make_interval(days => ${RETENTION.auditDays}::int)`))
      .returning({ id: tagAudit.id });
    // Two days: today's and yesterday's UTC windows stay.
    const limits = await tx
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, sql`${utcToday} - ${RETENTION.rateLimitDays - 1}::int`))
      .returning({ bucket: rateLimits.bucket });
    // Two days, as rate_limits: today's and yesterday's UTC rows stay, so the next fold still sees yesterday's.
    const days = await tx
      .delete(deviceDays)
      .where(lt(deviceDays.day, sql`${utcToday} - ${RETENTION.deviceDayDays - 1}::int`))
      .returning({ deviceHash: deviceDays.deviceHash });
    const unlinked = await tx
      .update(suggestions)
      .set({ deviceHash: null })
      .where(
        and(
          isNotNull(suggestions.deviceHash),
          lt(suggestions.createdAt, sql`now() - make_interval(days => ${RETENTION.suggestionLinkDays}::int)`),
        ),
      )
      .returning({ id: suggestions.id });
    // A device with a day noted but not yet folded wrote after the fold above, so it isn't inactive: its record, and
    // its App Attest key, stay for the next fold to bring up to date.
    const purged = await tx
      .delete(devices)
      .where(
        and(
          eq(devices.blocked, false),
          lt(
            devices.lastSeenDate,
            sql`(${utcToday} - make_interval(months => ${RETENTION.inactiveDeviceMonths}::int))::date`,
          ),
          notExists(tx.select().from(deviceDays).where(eq(deviceDays.deviceHash, devices.deviceHash))),
        ),
      )
      .returning({ deviceHash: devices.deviceHash });
    // Spec §6: a challenge lives 5 minutes; spending one deletes it, and issuing one deletes those already expired, so
    // only those that expired since the last one was issued are left here.
    const challengesPurged = await deleteExpiredChallenges(tx);
    // Two days, as device_days: today's and yesterday's tokens stay spent.
    const tokens = await tx
      .delete(deviceCheckTokens)
      .where(lt(deviceCheckTokens.seenOn, sql`${utcToday} - ${RETENTION.deviceCheckTokenDays - 1}::int`))
      .returning({ tokenHash: deviceCheckTokens.tokenHash });
    return {
      auditRowsPurged: audit.length,
      rateLimitRowsPurged: limits.length,
      suggestionsUnlinked: unlinked.length,
      devicesPurged: purged.length,
      challengesPurged,
      deviceDaysPurged: days.length,
      deviceCheckTokensPurged: tokens.length,
    };
  });
  const meetingsWithTags = await db.transaction((tx) => recountAllTags(tx));
  return { meetingsWithTags, devicesFolded, ...purges };
}
