import { sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { tagSwings } from "@/db/schema";

const MIN_NEW_DEVICES = 5;
const MAX_PRIOR_DEVICES = 10;

// Spec §6: flags a tag that gained 5+ devices (new submissions or re-confirmations) in the last 48 hours on a
// meeting that had fewer than 10 counted devices before them. Only counted rows take part (not excluded, confirmed
// within 180 days). An open flag isn't repeated; the admin reviews it with the 7-day audit rows.
export async function flagTagSwings(meetingId: string, executor: Executor): Promise<void> {
  await executor.execute(sql`
    with counted as (
      select tag_ids, confirmed_at > now() - interval '48 hours' as recent
      from tag_submissions
      where meeting_id = ${meetingId}::uuid and not excluded and confirmed_at > now() - interval '180 days'
    ),
    prior as (select count(*)::int as devices from counted where not recent),
    gained as (
      select tag_id, count(*)::int as devices
      from counted cross join lateral unnest(tag_ids) tag_id
      where recent
      group by tag_id
    )
    insert into ${tagSwings} (meeting_id, tag_id, new_devices, prior_devices)
    select ${meetingId}::uuid, gained.tag_id, gained.devices, prior.devices
    from gained cross join prior
    where gained.devices >= ${MIN_NEW_DEVICES} and prior.devices < ${MAX_PRIOR_DEVICES}
    on conflict (meeting_id, tag_id) where reviewed_at is null do nothing
  `);
}
