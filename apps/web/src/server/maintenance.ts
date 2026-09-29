import { and, isNotNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { devices, rateLimits, suggestions, tagAudit } from "@/db/schema";
import { recountAllTags } from "@/server/tags/counts";

export const MaintenanceSummary = z.object({
  meetingsWithTags: z.number().int(),
  auditRowsPurged: z.number().int(),
  rateLimitRowsPurged: z.number().int(),
  suggestionsUnlinked: z.number().int(),
  devicesPurged: z.number().int(),
});
export type MaintenanceSummary = z.infer<typeof MaintenanceSummary>;

// Spec §5, §6 and §13, nightly and idempotent: rebuild every count, then enforce each retention limit. Blocked
// devices are purged like any other once inactive: blocking only stops future writes, and nothing else keys off
// the row once its retention window has passed.
export async function runMaintenance(): Promise<MaintenanceSummary> {
  return db.transaction(async (tx) => {
    const meetingsWithTags = await recountAllTags(tx);
    const audit = await tx
      .delete(tagAudit)
      .where(lt(tagAudit.at, sql`now() - interval '7 days'`))
      .returning({ id: tagAudit.id });
    // Two days: today's and yesterday's UTC windows stay.
    const limits = await tx
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, sql`(now() at time zone 'utc')::date - 1`))
      .returning({ bucket: rateLimits.bucket });
    const unlinked = await tx
      .update(suggestions)
      .set({ deviceHash: null })
      .where(
        and(isNotNull(suggestions.deviceHash), lt(suggestions.createdAt, sql`now() - interval '30 days'`)),
      )
      .returning({ id: suggestions.id });
    const purged = await tx
      .delete(devices)
      .where(lt(devices.lastSeenDate, sql`((now() at time zone 'utc') - interval '13 months')::date`))
      .returning({ deviceHash: devices.deviceHash });
    return {
      meetingsWithTags,
      auditRowsPurged: audit.length,
      rateLimitRowsPurged: limits.length,
      suggestionsUnlinked: unlinked.length,
      devicesPurged: purged.length,
    };
  });
}
