import type { TagCount } from "@mymeetingapp/shared";
import { eq, sql } from "drizzle-orm";

import { feedMeetings, meetings } from "@/db/schema";

// Drizzle leaves column names unqualified in a single-table query, where a bare "id" inside the subquery below
// would mean tags.id. Qualifying them keeps the subquery correct whatever the outer query selects from.
const outerMeeting = (column: typeof meetings.id | typeof meetings.tagsDisabled) =>
  sql`${meetings}.${sql.identifier(column.name)}`;

// Spec §5 display rule: highest count first, ties by how many were near the meeting, then vocabulary order.
// Retired tags stay counted but hidden, and a meeting whose group opted out shows none. Always read fresh from
// tag_counts, never cached with the meeting.
export const tagCountsJson = sql<TagCount[]>`coalesce((
  select json_agg(json_build_object('slug', t.slug, 'count', c.device_count)
    order by c.device_count desc, c.verified_count desc, t.sort_order, t.slug)
  from tag_counts c join tags t on t.id = c.tag_id
  where c.meeting_id = ${outerMeeting(meetings.id)} and t.status = 'active'
    and not ${outerMeeting(meetings.tagsDisabled)}
), '[]'::json)`;

// Identity, location and time zone come from the canonical meeting; everything shown comes from its primary source.
export const summaryColumns = {
  id: meetings.id,
  name: feedMeetings.name,
  day: meetings.day,
  time: meetings.time,
  endTime: feedMeetings.endTime,
  timezone: meetings.timezone,
  types: feedMeetings.types,
  attendance: feedMeetings.attendance,
  locationName: feedMeetings.locationName,
  formattedAddress: feedMeetings.formattedAddress,
  latitude: meetings.latitude,
  longitude: meetings.longitude,
  locationNotes: feedMeetings.locationNotes,
  notes: feedMeetings.notes,
  groupName: feedMeetings.groupName,
  conferenceUrl: feedMeetings.conferenceUrl,
  conferenceUrlNotes: feedMeetings.conferenceUrlNotes,
  conferencePhone: feedMeetings.conferencePhone,
  conferencePhoneNotes: feedMeetings.conferencePhoneNotes,
  sourceUrl: feedMeetings.sourceUrl,
  tagsDisabled: meetings.tagsDisabled,
  tags: tagCountsJson,
};

// Written once: every meeting-summary query joins a meeting to the feed_meetings row that is its primary source.
export const primarySourceJoin = eq(feedMeetings.id, meetings.primaryFeedMeetingId);
