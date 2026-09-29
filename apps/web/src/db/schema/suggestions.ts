import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { tags } from "@/db/schema/tags";
import { sqlStringList } from "@/db/sql";

const SUGGESTION_STATUSES = ["pending", "merged", "rejected"] as const;
export const AI_DECISIONS = ["merge", "reject", "pending"] as const;

// Spec §5: the text is kept; the device link lasts only until review or 30 days, whichever comes first.
export const suggestions = pgTable(
  "suggestions",
  {
    id: serial("id").primaryKey(),
    text: text("text").notNull(),
    status: text("status", { enum: SUGGESTION_STATUSES }).notNull().default("pending"),
    mergedTagId: integer("merged_tag_id").references(() => tags.id),
    deviceHash: text("device_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    check("suggestions_status_check", sql`${table.status} in (${sqlStringList(SUGGESTION_STATUSES)})`),
    check("suggestions_text_check", sql`char_length(${table.text}) between 2 and 40`),
    check(
      "suggestions_merged_tag_check",
      sql`(${table.status} = 'merged') = (${table.mergedTagId} is not null)`,
    ),
    index("suggestions_device_idx").on(table.deviceHash),
  ],
);

// Spec §5: every AI screening decision exactly as the AI gave it, even when it isn't applied.
export const aiDecisions = pgTable(
  "ai_decisions",
  {
    id: serial("id").primaryKey(),
    suggestionId: integer("suggestion_id")
      .notNull()
      .references(() => suggestions.id),
    input: text("input").notNull(),
    decision: text("decision", { enum: AI_DECISIONS }).notNull(),
    tagSlug: text("tag_slug"),
    reason: text("reason").notNull(),
    model: text("model").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ai_decisions_decision_check", sql`${table.decision} in (${sqlStringList(AI_DECISIONS)})`),
  ],
);
