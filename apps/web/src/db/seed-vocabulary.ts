import { STARTER_VOCABULARY } from "@mymeetingapp/shared";
import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { tags } from "@/db/schema";

// Upserts label, category and order by slug. Never touches status, so retired tags stay retired.
export async function seedVocabulary(): Promise<number> {
  const rows = STARTER_VOCABULARY.map((tag, index) => ({ ...tag, sortOrder: index }));
  await db
    .insert(tags)
    .values(rows)
    .onConflictDoUpdate({
      target: tags.slug,
      set: {
        label: sql`excluded.label`,
        category: sql`excluded.category`,
        sortOrder: sql`excluded.sort_order`,
      },
    });
  return rows.length;
}
