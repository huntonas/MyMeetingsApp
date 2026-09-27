import tzlookup from "@photostructure/tz-lookup";
import { and, inArray, isNull, isNotNull, sql } from "drizzle-orm";

import { db, type Executor } from "@/db/client";
import { meetings } from "@/db/schema";
import { sqlArray } from "@/db/sql";

// Spec §3: a canonical meeting shows its highest-priority active source and is archived once none remain.
export async function recomputeMeetings(meetingIds: string[], executor: Executor = db): Promise<void> {
  if (meetingIds.length === 0) return;
  const ids = sqlArray(meetingIds, "uuid");

  await executor.execute(sql`
    with primary_source as (
      select distinct on (fm.meeting_id)
        fm.meeting_id, fm.id, fm.day, fm.time, fm.timezone, fm.address_key, fm.latitude, fm.longitude
      from feed_meetings fm
      join feeds f on f.id = fm.feed_id
      where fm.meeting_id = any(${ids}) and fm.archived_at is null and not f.opted_out
      order by fm.meeting_id, f.priority, fm.id
    )
    update meetings m set
      primary_feed_meeting_id = p.id,
      day = p.day,
      time = p.time,
      latitude = coalesce(p.latitude, g.latitude),
      longitude = coalesce(p.longitude, g.longitude),
      timezone = p.timezone,
      archived_at = null,
      updated_at = now()
    from primary_source p
    left join address_geocodes g on g.address_key = p.address_key and g.status = 'matched'
    where m.id = p.meeting_id
  `);

  await executor.execute(sql`
    update meetings m set archived_at = now(), updated_at = now()
    where m.id = any(${ids}) and m.archived_at is null and not exists (
      select 1 from feed_meetings fm join feeds f on f.id = fm.feed_id
      where fm.meeting_id = m.id and fm.archived_at is null and not f.opted_out
    )
  `);

  // Spec §3: the time zone comes from the feed when given, otherwise from the coordinates.
  const missingZone = await executor
    .select({ id: meetings.id, latitude: meetings.latitude, longitude: meetings.longitude })
    .from(meetings)
    .where(
      and(
        inArray(meetings.id, meetingIds),
        isNull(meetings.timezone),
        isNotNull(meetings.latitude),
        isNotNull(meetings.longitude),
      ),
    );
  for (const row of missingZone) {
    if (row.latitude === null || row.longitude === null) continue;
    await executor.execute(
      sql`update meetings set timezone = ${tzlookup(row.latitude, row.longitude)} where id = ${row.id}`,
    );
  }
}
