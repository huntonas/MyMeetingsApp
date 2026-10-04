import { TAG_CATEGORIES } from "@mymeetingapp/shared";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { tags } from "@/db/schema";
import { sqlStringList } from "@/db/sql";

// Categories in TAG_CATEGORIES order, then each tag's place in its list: how the app and the admin show the
// vocabulary.
export const VOCABULARY_ORDER = [
  sql`array_position(array[${sqlStringList(TAG_CATEGORIES)}]::text[], ${tags.category})`,
  asc(tags.sortOrder),
  asc(tags.slug),
];

// The active tags in `categories` only: /api/v1 leaves out the categories older builds can't read. The rows are typed
// by the categories asked for, which the query guarantees.
export async function getActiveVocabulary<Category extends (typeof TAG_CATEGORIES)[number]>(
  categories: readonly Category[],
) {
  const rows = await db
    .select({ slug: tags.slug, label: tags.label, category: tags.category })
    .from(tags)
    .where(and(eq(tags.status, "active"), inArray(tags.category, categories)))
    .orderBy(...VOCABULARY_ORDER);
  return rows as { slug: string; label: string; category: Category }[];
}
