import tzlookup from "@photostructure/tz-lookup";
import { and, inArray, isNull, isNotNull, sql } from "drizzle-orm";

import { db, type Executor } from "@/db/client";
import { meetings } from "@/db/schema";
import { sqlArray } from "@/db/sql";

// Spec §3: a canonical meeting shows its highest-priority active source and is archived once none remain.
// Coordinates come from that source, then its address's geocode, then the highest-priority active source
// that has them. A time zone the feed doesn't give is kept once looked up, so the lookup runs only once.
export async function recomputeMeetings(meetingIds: string[], executor: Executor = db): Promise<void> {
  if (meetingIds.length === 0) return;
  const ids = sqlArray(meetingIds, "uuid");

  await executor.execute(sql`
    with active_source as (
      select fm.meeting_id, fm.id, fm.day, fm.time, fm.timezone, fm.address_key, fm.latitude, fm.longitude,
        f.priority
      from feed_meetings fm
      join feeds f on f.id = fm.feed_id
      where fm.meeting_id = any(${ids}) and fm.archived_at is null and not f.opted_out
    ),
    primary_source as (
      select distinct on (meeting_id) * from active_source order by meeting_id, priority, id
    ),
    located_source as (
      select distinct on (meeting_id) meeting_id, latitude, longitude from active_source
      where latitude is not null and longitude is not null
      order by meeting_id, priority, id
    )
    update meetings m set
      primary_feed_meeting_id = p.id,
      day = p.day,
      time = p.time,
      latitude = coalesce(p.latitude, g.latitude, l.latitude),
      longitude = coalesce(p.longitude, g.longitude, l.longitude),
      timezone = coalesce(p.timezone, m.timezone),
      archived_at = null,
      updated_at = now()
    from primary_source p
    left join address_geocodes g on g.address_key = p.address_key and g.status = 'matched'
    left join located_source l on l.meeting_id = p.meeting_id
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
