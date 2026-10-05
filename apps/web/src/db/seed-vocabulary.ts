import { STARTER_VOCABULARY } from "@mymeetingapp/shared";
import { eq, notInArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { tags } from "@/db/schema";

// Upserts label, category and order by slug. Never touches status, so retired tags stay retired. Tags it didn't seed
// (approved suggestions) move after the seeded ones, keeping their own order, so a longer vocabulary never puts an
// approved tag ahead of seeded tags in its category.
export async function seedVocabulary(): Promise<number> {
  const rows = STARTER_VOCABULARY.map((tag, index) => ({ ...tag, sortOrder: index }));
  await db.transaction(async (tx) => {
    await tx
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
    const others = tx.$with("others").as(
      tx
        .select({
          id: tags.id,
          rank: sql<number>`row_number() over (order by ${tags.sortOrder}, ${tags.slug})`.as("rank"),
        })
        .from(tags)
        .where(
          notInArray(
            tags.slug,
            rows.map((row) => row.slug),
          ),
        ),
    );
    await tx
      .with(others)
      .update(tags)
      .set({ sortOrder: sql`${rows.length - 1} + ${others.rank}` })
      .from(others)
      .where(eq(tags.id, others.id));
  });
  return rows.length;
}
