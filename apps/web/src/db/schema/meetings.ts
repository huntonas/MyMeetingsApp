import type { MeetingSummary } from "@mymeetingapp/shared";
import { type SQL, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { feeds } from "@/db/schema/feeds";
import { sqlStringList } from "@/db/sql";

const ATTENDANCE_OPTIONS = ["in_person", "hybrid", "online"] as const;
const GEOCODE_STATUSES = ["matched", "no_match"] as const;

// A real-world meeting. Tags and the API use its id. Display fields live on its primary source row.
export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    primaryFeedMeetingId: bigint("primary_feed_meeting_id", { mode: "number" }),
    day: smallint("day").notNull(),
    time: text("time").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    timezone: text("timezone"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("meetings_day_time_idx").on(table.day, table.time)],
);

// Spec §3: the one comparable form of a conference URL, used for the stored conference_key column and for
// rows not yet stored. Zoom links become "zoom:<meeting id or personal link>", ignoring the regional
// subdomain, query, fragment and stray spaces. Other URLs keep their query, which can name the meeting (Webex
// MTID), and only lose surrounding whitespace, the fragment and a trailing slash, with the scheme and host
// lowercased.
export function conferenceKey(url: SQL): SQL {
  const trimmed = sql`regexp_replace(${url}, '^[[:space:]]+|[[:space:]]+$', '', 'g')`;
  return sql`coalesce(
    'zoom:' || (regexp_match(regexp_replace(lower(${url}), '%20|[[:space:]]', '', 'g'),
      '^https?://(?:[a-z0-9-]+[.])*zoom[.]us/(?:j|my|w|s)/([^/?#]+)'))[1],
    rtrim(regexp_replace(
      lower(substring(${trimmed} from '^[^/?#]*//[^/?#]*')) || substring(${trimmed} from '^[^/?#]*//[^/?#]*(.*)$'),
      '#.*$', ''), '/')
  )`;
}

// One source's listing of a meeting on one day, holding only allowlisted fields (spec §3).
export const feedMeetings = pgTable(
  "feed_meetings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    feedId: integer("feed_id")
      .notNull()
      .references(() => feeds.id),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id),
    sourceSlug: text("source_slug").notNull(),
    day: smallint("day").notNull(),
    time: text("time").notNull(),
    endTime: text("end_time"),
    timezone: text("timezone"),
    name: text("name").notNull(),
    types: text("types").array().notNull().$type<MeetingSummary["types"]>(),
    attendance: text("attendance", { enum: ATTENDANCE_OPTIONS }).notNull(),
    locationName: text("location_name"),
    formattedAddress: text("formatted_address"),
    addressKey: text("address_key"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    locationNotes: text("location_notes"),
    notes: text("notes"),
    groupName: text("group_name"),
    conferenceUrl: text("conference_url"),
    conferenceKey: text("conference_key").generatedAlwaysAs(conferenceKey(sql.raw(`"conference_url"`))),
    conferenceUrlNotes: text("conference_url_notes"),
    conferencePhone: text("conference_phone"),
    conferencePhoneNotes: text("conference_phone_notes"),
    sourceUrl: text("source_url"),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("feed_meetings_feed_slug_day_unique").on(table.feedId, table.sourceSlug, table.day),
    index("feed_meetings_meeting_idx").on(table.meetingId),
    index("feed_meetings_address_key_idx").on(table.addressKey),
    index("feed_meetings_conference_key_idx").on(table.conferenceKey),
    check("feed_meetings_day_check", sql`${table.day} between 0 and 6`),
    check(
      "feed_meetings_attendance_check",
      sql`${table.attendance} in (${sqlStringList(ATTENDANCE_OPTIONS)})`,
    ),
  ],
);

// Census geocoder results, keyed by normalized address so every feed and re-sync reuses them.
export const addressGeocodes = pgTable(
  "address_geocodes",
  {
    addressKey: text("address_key").primaryKey(),
    status: text("status", { enum: GEOCODE_STATUSES }).notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("address_geocodes_status_check", sql`${table.status} in (${sqlStringList(GEOCODE_STATUSES)})`),
  ],
);

// Generated from latitude/longitude by migration 0003 (drizzle-kit can't emit geography columns correctly).
export const meetingLocation = sql.raw(`"meetings"."location"`);
