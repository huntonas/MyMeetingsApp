import { TAG_CATEGORIES } from "@mymeetingapp/shared";
import { asc, eq, sql } from "drizzle-orm";

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

export async function getActiveVocabulary() {
  return db
    .select({ slug: tags.slug, label: tags.label, category: tags.category })
    .from(tags)
    .where(eq(tags.status, "active"))
    .orderBy(...VOCABULARY_ORDER);
}
