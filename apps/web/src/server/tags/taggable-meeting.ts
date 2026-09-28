import { eq, sql } from "drizzle-orm";

import type { Executor } from "@/db/client";
import { feedMeetings, meetings } from "@/db/schema";
import { ApiError } from "@/lib/api/respond";
import { resolveMeetingId } from "@/server/meetings/aliases";
import { primarySourceJoin } from "@/server/meetings/summary";
import { taggingWindowOpen } from "@/server/tags/window";

// Holds the meeting row for the rest of the write's transaction. The sync's merge locks every meeting it merges
// before moving their tags (carryTagsOnMerge), so the two take turns: a write never adds a row to a meeting the
// merge has already emptied and is about to delete, and never misses a row the merge is moving onto it.
function lockedMeeting(meetingId: string, executor: Executor) {
  return executor
    .select({
      id: meetings.id,
      archived: sql<boolean>`${meetings.archivedAt} is not null`,
      tagsDisabled: meetings.tagsDisabled,
      online: sql<boolean>`coalesce(${feedMeetings.attendance} = 'online', false)`,
      windowOpen: taggingWindowOpen(new Date()),
    })
    .from(meetings)
    .leftJoin(feedMeetings, primarySourceJoin)
    .where(eq(meetings.id, meetingId))
    .for("share", { of: meetings });
}

// The meeting a tag write names, after following a merge. Archived meetings are returned too: edits and deletes
// work on them at any time, and new submissions check `archived`.
export async function findTaggableMeeting(requestedId: string, executor: Executor) {
  const [meeting] = await lockedMeeting(await resolveMeetingId(requestedId, executor), executor);
  if (meeting !== undefined) return meeting;
  // A merge that committed while this waited for the lock deleted the meeting, and its alias is now visible.
  const [merged] = await lockedMeeting(await resolveMeetingId(requestedId, executor), executor);
  if (merged === undefined) throw new ApiError("meeting_not_found");
  return merged;
}
