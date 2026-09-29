import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { devices, rateLimits, suggestions, tagAudit } from "@/db/schema";
import { utcToday } from "@/db/sql";
import { recountAllTags } from "@/server/tags/counts";

export const MaintenanceSummary = z.object({
  meetingsWithTags: z.number().int(),
  auditRowsPurged: z.number().int(),
  rateLimitRowsPurged: z.number().int(),
  suggestionsUnlinked: z.number().int(),
  devicesPurged: z.number().int(),
});
export type MaintenanceSummary = z.infer<typeof MaintenanceSummary>;

// Spec §5, §6 and §13, nightly and idempotent: enforce each retention limit, then rebuild every count last, so
// the brief EXCLUSIVE lock recountAllTags takes on tag_counts (see there) doesn't hold up the other purges a
// moment longer than it has to. Blocked devices are exempt from the 13-month purge: blocking is a standing
// decision the owner made, and even delete-mine can't undo it, so the row must outlive inactivity too.
export async function runMaintenance(): Promise<MaintenanceSummary> {
  return db.transaction(async (tx) => {
    const audit = await tx
      .delete(tagAudit)
      .where(lt(tagAudit.at, sql`now() - interval '7 days'`))
      .returning({ id: tagAudit.id });
    // Two days: today's and yesterday's UTC windows stay.
    const limits = await tx
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, sql`${utcToday} - 1`))
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
      .where(
        and(
          eq(devices.blocked, false),
          lt(devices.lastSeenDate, sql`(${utcToday} - interval '13 months')::date`),
        ),
      )
      .returning({ deviceHash: devices.deviceHash });
    const meetingsWithTags = await recountAllTags(tx);
    return {
      meetingsWithTags,
      auditRowsPurged: audit.length,
      rateLimitRowsPurged: limits.length,
      suggestionsUnlinked: unlinked.length,
      devicesPurged: purged.length,
    };
  });
}
