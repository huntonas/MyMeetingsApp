import { date, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { utcToday } from "@/db/sql";

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

// Spec §6: the SHA-256 of each DeviceCheck token a write was accepted with, so a token works once. Kept
// RETENTION.deviceCheckTokenDays. Linked to nothing: the phone that sent it isn't recorded.
export const deviceCheckTokens = pgTable("devicecheck_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  seenOn: date("seen_on").notNull().default(utcToday),
});
