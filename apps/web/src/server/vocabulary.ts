import { TAG_CATEGORIES } from "@mymeetingapp/shared";
import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { tags } from "@/db/schema";
import { sqlStringList } from "@/db/sql";

export async function getActiveVocabulary() {
  return db
    .select({ slug: tags.slug, label: tags.label, category: tags.category })
    .from(tags)
    .where(eq(tags.status, "active"))
    .orderBy(
      sql`array_position(array[${sqlStringList(TAG_CATEGORIES)}]::text[], ${tags.category})`,
      asc(tags.sortOrder),
    );
}
