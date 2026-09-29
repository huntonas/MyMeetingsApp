import { type SQL, sql } from "drizzle-orm";

import { meetings } from "@/db/schema";

const WINDOW = sql`interval '36 hours'`;

// Spec §5: new submissions are allowed from the start of the meeting's most recent occurrence until 36 hours
// later, in the meeting's own time zone. `now` is read as local time in that zone, the latest local date on the
// meeting's weekday at or before it gets the start time, and AT TIME ZONE turns that local start back into an
// instant with the zone's DST rules. So a DST change moves the instant, not the local start. A meeting without a
// time zone is never open (AT TIME ZONE null is null).
export function taggingWindowOpen(now: Date): SQL<boolean> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const local = sql`(${at} at time zone ${meetings.timezone})`;
  const onWeekday = sql`(date_trunc('day', ${local})
    - make_interval(days => (extract(dow from ${local})::int - ${meetings.day} + 7) % 7)
    + ${meetings.time}::time)`;
  const start = sql`((case when ${onWeekday} > ${local} then ${onWeekday} - interval '7 days' else ${onWeekday} end)
    at time zone ${meetings.timezone})`;
  return sql<boolean>`coalesce(${at} >= ${start} and ${at} < ${start} + ${WINDOW}, false)`;
}
