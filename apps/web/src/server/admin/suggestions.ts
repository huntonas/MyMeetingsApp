import { TAG_CATEGORIES, TagLabelText, TagSlug } from "@mymeetingapp/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db, type Executor } from "@/db/client";
import { aiDecisions, suggestions, tags } from "@/db/schema";
import { FormId } from "@/server/admin/form-fields";
import type { AdminNotice } from "@/server/admin/notices";

const RECENT_DECISIONS = 50;

export const ApproveSuggestionForm = z.object({
  suggestionId: FormId,
  label: TagLabelText,
  category: z.enum(TAG_CATEGORIES),
});
export const MergeSuggestionForm = z.object({ suggestionId: FormId, tagSlug: TagSlug });
export const RejectSuggestionForm = z.object({ suggestionId: FormId });

// Spec §5: the weekly review. Pending suggestions oldest first, each with every AI decision logged for it. The
// device link is never read here.
export async function listPendingSuggestions() {
  const pending = await db
    .select({ id: suggestions.id, text: suggestions.text, createdAt: suggestions.createdAt })
    .from(suggestions)
    .where(eq(suggestions.status, "pending"))
    .orderBy(asc(suggestions.createdAt), asc(suggestions.id));
  const decisions =
    pending.length === 0
      ? []
      : await db
          .select({
            suggestionId: aiDecisions.suggestionId,
            decision: aiDecisions.decision,
            tagSlug: aiDecisions.tagSlug,
            reason: aiDecisions.reason,
            model: aiDecisions.model,
            decidedAt: aiDecisions.decidedAt,
          })
          .from(aiDecisions)
          .where(
            inArray(
              aiDecisions.suggestionId,
              pending.map((row) => row.id),
            ),
          )
          .orderBy(asc(aiDecisions.decidedAt), asc(aiDecisions.id));
  return pending.map((row) => ({
    ...row,
    decisions: decisions.filter((decision) => decision.suggestionId === row.id),
  }));
}

// Spec §10: the AI decision log, newest first, with what became of each suggestion.
export async function listRecentAiDecisions() {
  return db
    .select({
      id: aiDecisions.id,
      input: aiDecisions.input,
      decision: aiDecisions.decision,
      tagSlug: aiDecisions.tagSlug,
      reason: aiDecisions.reason,
      model: aiDecisions.model,
      decidedAt: aiDecisions.decidedAt,
      status: suggestions.status,
    })
    .from(aiDecisions)
    .innerJoin(suggestions, eq(suggestions.id, aiDecisions.suggestionId))
    .orderBy(desc(aiDecisions.decidedAt), desc(aiDecisions.id))
    .limit(RECENT_DECISIONS);
}

// "Café & chat" becomes "cafe-and-chat". A label with no letters a–z left gives no id.
function tagSlugFor(label: string): string | undefined {
  const slug = label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return TagSlug.safeParse(slug).success ? slug : undefined;
}

// Spec §5: reviewing ends the suggestion's link to its device. Only a pending suggestion changes, so a form sent
// twice reviews once.
async function markReviewed(
  suggestionId: number,
  status: "approved" | "merged" | "rejected",
  mergedTagId: number | null,
  executor: Executor,
): Promise<boolean> {
  const reviewed = await executor
    .update(suggestions)
    .set({ status, mergedTagId, deviceHash: null, reviewedAt: sql`now()` })
    .where(and(eq(suggestions.id, suggestionId), eq(suggestions.status, "pending")))
    .returning({ id: suggestions.id });
  return reviewed.length > 0;
}

// Adds the label as a new active tag, last in the vocabulary order, and marks the suggestion approved.
export async function approveSuggestion(input: z.output<typeof ApproveSuggestionForm>): Promise<AdminNotice> {
  const slug = tagSlugFor(input.label);
  if (slug === undefined) return "label_invalid";
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ id: suggestions.id })
      .from(suggestions)
      .where(and(eq(suggestions.id, input.suggestionId), eq(suggestions.status, "pending")))
      .for("update");
    if (pending === undefined) return "already_reviewed";
    const [tag] = await tx
      .insert(tags)
      .values({
        slug,
        label: input.label,
        category: input.category,
        sortOrder: sql`(select coalesce(max(${tags.sortOrder}), -1) + 1 from ${tags})`,
      })
      .onConflictDoNothing({ target: tags.slug })
      .returning({ id: tags.id });
    if (tag === undefined) return "tag_exists";
    await markReviewed(input.suggestionId, "approved", tag.id, tx);
    return "approved";
  });
}

export async function mergeSuggestion(input: z.output<typeof MergeSuggestionForm>): Promise<AdminNotice> {
  return db.transaction(async (tx) => {
    const [tag] = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.slug, input.tagSlug), eq(tags.status, "active")));
    if (tag === undefined) return "tag_not_found";
    return (await markReviewed(input.suggestionId, "merged", tag.id, tx)) ? "merged" : "already_reviewed";
  });
}

export async function rejectSuggestion(input: z.output<typeof RejectSuggestionForm>): Promise<AdminNotice> {
  return (await markReviewed(input.suggestionId, "rejected", null, db)) ? "rejected" : "already_reviewed";
}
