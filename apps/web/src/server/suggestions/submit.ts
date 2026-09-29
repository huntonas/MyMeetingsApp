import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { aiDecisions, suggestions, tags } from "@/db/schema";
import { readEnv } from "@/env";
import { logError } from "@/lib/log";
import { consumeDailyLimit } from "@/server/devices/rate-limit";
import { writeAsDevice, type WriteDevice } from "@/server/devices/write-request";
import { screenSuggestion } from "@/server/suggestions/screen";
import { getActiveVocabulary } from "@/server/vocabulary";

async function applyScreening(
  id: number,
  text: string,
  model: string,
  screened: Awaited<ReturnType<typeof screenSuggestion>>,
): Promise<void> {
  const [mergedTag] =
    screened.decision === "merge" && screened.tagSlug !== null
      ? await db
          .select({ id: tags.id })
          .from(tags)
          .where(and(eq(tags.slug, screened.tagSlug), eq(tags.status, "active")))
      : [];
  await db.transaction(async (tx) => {
    await tx.insert(aiDecisions).values({
      suggestionId: id,
      input: text,
      decision: screened.decision,
      tagSlug: screened.tagSlug,
      reason: screened.reason,
      model,
    });
    if (screened.decision === "reject" || mergedTag !== undefined) {
      await tx
        .update(suggestions)
        .set({
          status: mergedTag === undefined ? "rejected" : "merged",
          mergedTagId: mergedTag?.id ?? null,
          deviceHash: null,
          reviewedAt: sql`now()`,
        })
        .where(eq(suggestions.id, id));
    }
  });
}

// Spec §5: clear synonyms merge into their tag, and names, judgments or identifying text are rejected. Both count
// as reviewed, so the device link goes. Everything else waits for the weekly human review. Every decision is
// logged as the AI gave it. A failed or unconfigured screening, or a failure recording it, leaves the suggestion
// pending: the suggestion is already saved, so the request still succeeds.
async function screenAndApply(id: number, text: string): Promise<void> {
  const model = readEnv("SUGGESTION_MODEL");
  if (model === undefined) {
    console.warn("[suggestions] SUGGESTION_MODEL is not set; leaving the suggestion for review");
    return;
  }
  let screened: Awaited<ReturnType<typeof screenSuggestion>>;
  try {
    screened = await screenSuggestion(text, await getActiveVocabulary(), model);
  } catch (error) {
    // An AI SDK error can quote the request, which holds the suggestion's text, so only its type is logged.
    logError("[suggestions] AI screening failed", error instanceof Error ? error.name : "unknown error");
    return;
  }
  try {
    await applyScreening(id, text, model, screened);
  } catch (error) {
    // logError keeps only a database error's SQL text and structured fields, so the suggestion's text isn't logged.
    logError("[suggestions] recording the AI screening failed", error);
  }
}

// The suggestion is committed before screening, so the AI call never holds a database transaction open.
export async function submitSuggestion(device: WriteDevice, text: string): Promise<void> {
  const id = await writeAsDevice(device, async (tx) => {
    await consumeDailyLimit(device.deviceHash, "suggestion", tx);
    const [row] = await tx
      .insert(suggestions)
      .values({ text, deviceHash: device.deviceHash })
      .returning({ id: suggestions.id });
    if (row === undefined) throw new Error("the suggestion was not saved");
    return row.id;
  });
  await screenAndApply(id, text);
}
