import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Spec §6: single-use App Attest challenges, kept RETENTION.challengeMinutes. Linked to nothing: the phone that asked
// isn't recorded with its challenge.
export const attestChallenges = pgTable(
  "attest_challenges",
  {
    challenge: text("challenge").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("attest_challenges_expires_idx").on(table.expiresAt)],
);
