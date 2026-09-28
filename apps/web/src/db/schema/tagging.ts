import { PLATFORMS } from "@mymeetingapp/shared";
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { meetings } from "@/db/schema/meetings";
import { tags } from "@/db/schema/tags";
import { sqlStringList } from "@/db/sql";

const AUDIT_ACTIONS = ["submit", "edit"] as const;

// Spec §3: every meeting a merge deleted, pointing at the live meeting that absorbed it. Chains are collapsed
// when a survivor merges again, so meeting_id always names a live meeting in one step.
export const meetingAliases = pgTable(
  "meeting_aliases",
  {
    oldMeetingId: uuid("old_meeting_id").primaryKey(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id),
  },
  (table) => [index("meeting_aliases_meeting_idx").on(table.meetingId)],
);

// Spec §5: one row per device per meeting. submitter_id is an HMAC of the device hash and scope_meeting_id: the
// meeting's own id, or the id of a meeting later merged into it (the row moved over unchanged).
export const tagSubmissions = pgTable(
  "tag_submissions",
  {
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id),
    submitterId: text("submitter_id").notNull(),
    scopeMeetingId: uuid("scope_meeting_id").notNull(),
    tagIds: integer("tag_ids").array().notNull(),
    nearMeeting: boolean("near_meeting").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    excluded: boolean("excluded").notNull().default(false),
  },
  (table) => [
    primaryKey({ name: "tag_submissions_pkey", columns: [table.meetingId, table.submitterId] }),
    index("tag_submissions_submitter_idx").on(table.submitterId),
    check("tag_submissions_submitter_check", sql`${table.submitterId} ~ '^[0-9a-f]{64}$'`),
    check("tag_submissions_tag_ids_check", sql`cardinality(${table.tagIds}) between 1 and 6`),
  ],
);

// Spec §5: kept in step with tag_submissions in the same transaction as every write, and rebuilt nightly.
export const tagCounts = pgTable(
  "tag_counts",
  {
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id),
    deviceCount: integer("device_count").notNull(),
    verifiedCount: integer("verified_count").notNull(),
  },
  (table) => [primaryKey({ name: "tag_counts_pkey", columns: [table.meetingId, table.tagId] })],
);

// Spec §6: the only link between a device and a meeting, purged after 7 days, for reviewing flagged swings.
export const tagAudit = pgTable(
  "tag_audit",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deviceHash: text("device_hash").notNull(),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id),
    action: text("action", { enum: AUDIT_ACTIONS }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tag_audit_meeting_idx").on(table.meetingId, table.at),
    index("tag_audit_device_idx").on(table.deviceHash),
    check("tag_audit_action_check", sql`${table.action} in (${sqlStringList(AUDIT_ACTIONS)})`),
  ],
);

// Spec §6: dates are UTC calendar days, so the table never holds a time of day.
const UTC_TODAY = sql`(now() at time zone 'utc')::date`;

// Spec §6: one row per device, keyed by its hash, with dates only and no meeting references.
export const devices = pgTable(
  "devices",
  {
    deviceHash: text("device_hash").primaryKey(),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    firstSeenDate: date("first_seen_date").notNull().default(UTC_TODAY),
    lastSeenDate: date("last_seen_date").notNull().default(UTC_TODAY),
    blocked: boolean("blocked").notNull().default(false),
  },
  (table) => [
    check("devices_platform_check", sql`${table.platform} in (${sqlStringList(PLATFORMS)})`),
    check("devices_hash_check", sql`${table.deviceHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
