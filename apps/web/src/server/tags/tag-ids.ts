import { MAX_TAGS_PER_SUBMISSION } from "@mymeetingapp/shared";
import { and, eq, inArray } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { tags } from "@/db/schema";
import { ApiError } from "@/lib/api/respond";

// Spec §5: 1 to 6 tags, all from the active vocabulary. Returns their ids in the order given.
export async function validTagIds(slugs: readonly string[], executor: Executor): Promise<number[]> {
  if (slugs.length > MAX_TAGS_PER_SUBMISSION) throw new ApiError("too_many_tags");
  const rows = await executor
    .select({ id: tags.id, slug: tags.slug })
    .from(tags)
    .where(and(inArray(tags.slug, [...slugs]), eq(tags.status, "active")));
  const idBySlug = new Map(rows.map((row) => [row.slug, row.id]));
  return slugs.map((slug) => {
    const id = idBySlug.get(slug);
    if (id === undefined) throw new ApiError("unknown_tag");
    return id;
  });
}
