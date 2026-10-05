import { FELLOWSHIPS } from "@mymeetingapp/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { db, type Executor } from "@/db/client";
import { ENTITY_TYPES, type EntityType, FEED_FORMATS, feeds, WAITING_REASONS } from "@/db/schema";

// Spec §3: intergroup and district feeds outrank area feeds, which often re-publish them.
// Exported so callers that must rank entities before upserting (e.g. seed-feeds.ts, when two
// registry entries share a feed_url) use the same defaults rather than duplicating them.
export const DEFAULT_PRIORITY: Record<EntityType, number> = {
  intergroup: 10,
  district: 10,
  central_office: 10,
  // NA's regions and zones publish their own meetings, as intergroups do.
  region: 10,
  area: 20,
};

export const FeedInput = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().trim().min(1),
  entityType: z.enum(ENTITY_TYPES),
  state: z.string().regex(/^[A-Z]{2}$/),
  url: z.url({ protocol: /^https?$/ }),
  priority: z.number().int().min(1).optional(),
  // Sets an opt-out as part of the same insert or update. An upsert can add an opt-out but never clear
  // one: that stays a deliberate, separate change.
  optedOut: z.boolean().optional(),
  // Only a new feed starts out waiting. Once the owner resumes one, an upsert never pauses it again.
  waitingReason: z.enum(WAITING_REASONS).optional(),
  fellowship: z.enum(FELLOWSHIPS).optional(),
  format: z.enum(FEED_FORMATS).optional(),
});

export type FeedInput = z.input<typeof FeedInput>;

const URL_CHANGED = sql`feeds.url <> excluded.url`;
const URL_OR_PRIORITY_CHANGED = sql`(${URL_CHANGED} or feeds.priority <> excluded.priority)`;

// A new URL or priority must take effect on the next sync even if the feed would answer 304, so the
// validators are dropped and the feed made due. A new URL also resets the shrink guard's baseline.
export async function upsertFeed(input: FeedInput, executor: Executor = db): Promise<number> {
  const feed = FeedInput.parse(input);
  const values = {
    ...feed,
    priority: feed.priority ?? DEFAULT_PRIORITY[feed.entityType],
    fellowship: feed.fellowship ?? "aa",
    format: feed.format ?? "meeting_guide",
  };
  const [row] = await executor
    .insert(feeds)
    .values(values)
    .onConflictDoUpdate({
      target: feeds.slug,
      set: {
        name: sql`excluded.name`,
        entityType: sql`excluded.entity_type`,
        state: sql`excluded.state`,
        url: sql`excluded.url`,
        fellowship: sql`excluded.fellowship`,
        format: sql`excluded.format`,
        priority: sql`excluded.priority`,
        optedOut: sql`feeds.opted_out or excluded.opted_out`,
        etag: sql`case when ${URL_OR_PRIORITY_CHANGED} then null else feeds.etag end`,
        lastModified: sql`case when ${URL_OR_PRIORITY_CHANGED} then null else feeds.last_modified end`,
        lastSuccessAt: sql`case when ${URL_OR_PRIORITY_CHANGED} then null else feeds.last_success_at end`,
        lastAttemptAt: sql`case when ${URL_OR_PRIORITY_CHANGED} then null else feeds.last_attempt_at end`,
        meetingCount: sql`case when ${URL_CHANGED} then null else feeds.meeting_count end`,
      },
    })
    .returning({ id: feeds.id });
  if (row === undefined) throw new Error("upsertFeed returned no row");
  return row.id;
}
