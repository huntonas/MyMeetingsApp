import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { tags } from "@/db/schema";
import { FormBoolean, FormId } from "@/server/admin/form-fields";
import type { AdminNotice } from "@/server/admin/notices";
import { VOCABULARY_ORDER } from "@/server/vocabulary";

export const TagStatusForm = z.object({ tagId: FormId, retired: FormBoolean });

export async function listVocabulary() {
  return db
    .select({ id: tags.id, slug: tags.slug, label: tags.label, category: tags.category, status: tags.status })
    .from(tags)
    .orderBy(...VOCABULARY_ORDER);
}

// Spec §5: a tag is retired (hidden in the app, its counts kept) or restored, never deleted.
export async function setTagRetired(input: z.output<typeof TagStatusForm>): Promise<AdminNotice> {
  const updated = await db
    .update(tags)
    .set({ status: input.retired ? "retired" : "active" })
    .where(eq(tags.id, input.tagId))
    .returning({ id: tags.id });
  if (updated.length === 0) return "tag_not_found";
  return input.retired ? "tag_retired" : "tag_restored";
}
