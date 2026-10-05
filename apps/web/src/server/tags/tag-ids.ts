import { MAX_TAGS_PER_SUBMISSION, SINGLE_CHOICE_CATEGORIES } from "@mymeetingapp/shared";
import { and, eq, inArray } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { tags } from "@/db/schema";
import { ApiError } from "@/lib/api/respond";

// Spec §5: 1 to 6 tags, all from the active vocabulary, and at most one from each single-choice category (one size).
// Returns their ids in the order given.
export async function validTagIds(slugs: readonly string[], executor: Executor): Promise<number[]> {
  if (slugs.length > MAX_TAGS_PER_SUBMISSION) throw new ApiError("too_many_tags");
  const rows = await executor
    .select({ id: tags.id, slug: tags.slug, category: tags.category })
    .from(tags)
    .where(and(inArray(tags.slug, [...slugs]), eq(tags.status, "active")));
  const idBySlug = new Map(rows.map((row) => [row.slug, row.id]));
  const ids = slugs.map((slug) => {
    const id = idBySlug.get(slug);
    if (id === undefined) throw new ApiError("unknown_tag");
    return id;
  });
  for (const category of SINGLE_CHOICE_CATEGORIES) {
    if (rows.filter((row) => row.category === category).length > 1) throw new ApiError("one_size");
  }
  return ids;
}
