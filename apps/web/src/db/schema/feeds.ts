import { sql } from "drizzle-orm";
import { boolean, check, date, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { sqlStringList } from "@/db/sql";

export const ENTITY_TYPES = ["area", "district", "intergroup", "central_office"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

// Why a feed is waiting for its office's permission: its list is restricted to keyed apps, or a bot check stops our
// server. The sync never fetches a waiting feed.
export const WAITING_REASONS = ["restricted", "bot_check"] as const;
export type WaitingReason = (typeof WAITING_REASONS)[number];

export const feeds = pgTable(
  "feeds",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    entityType: text("entity_type", { enum: ENTITY_TYPES }).notNull(),
    state: text("state").notNull(),
    url: text("url").notNull().unique(),
    // Lower wins when two feeds list the same meeting.
    priority: integer("priority").notNull(),
    optedOut: boolean("opted_out").notNull().default(false),
    waitingReason: text("waiting_reason", { enum: WAITING_REASONS }),
    // The owner's outreach to a waiting feed's office.
    contactEmail: text("contact_email"),
    contactedOn: date("contacted_on"),
    outreachNote: text("outreach_note"),
    // A restricted list's sharing key from its office, sent as ?key=. Kept only here, never in the registry.
    accessKey: text("access_key"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error"),
    meetingCount: integer("meeting_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("feeds_entity_type_check", sql`${table.entityType} in (${sqlStringList(ENTITY_TYPES)})`),
    check("feeds_state_check", sql`${table.state} ~ '^[A-Z]{2}$'`),
    check("feeds_waiting_reason_check", sql`${table.waitingReason} in (${sqlStringList(WAITING_REASONS)})`),
  ],
);
