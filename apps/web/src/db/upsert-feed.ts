import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { ENTITY_TYPES, type EntityType, feeds } from "@/db/schema";

// Spec §3: intergroup and district feeds outrank area feeds, which often re-publish them.
const DEFAULT_PRIORITY: Record<EntityType, number> = {
  intergroup: 10,
  district: 10,
  central_office: 10,
  area: 20,
};

export const FeedInput = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().trim().min(1),
  entityType: z.enum(ENTITY_TYPES),
  state: z.string().regex(/^[A-Z]{2}$/),
  url: z.url({ protocol: /^https?$/ }),
  priority: z.number().int().min(1).optional(),
});

export async function upsertFeed(input: z.input<typeof FeedInput>): Promise<number> {
  const feed = FeedInput.parse(input);
  const values = { ...feed, priority: feed.priority ?? DEFAULT_PRIORITY[feed.entityType] };
  const [row] = await db
    .insert(feeds)
    .values(values)
    .onConflictDoUpdate({
      target: feeds.slug,
      set: {
        name: sql`excluded.name`,
        entityType: sql`excluded.entity_type`,
        state: sql`excluded.state`,
        url: sql`excluded.url`,
        priority: sql`excluded.priority`,
      },
    })
    .returning({ id: feeds.id });
  if (row === undefined) throw new Error("upsertFeed returned no row");
  return row.id;
}
