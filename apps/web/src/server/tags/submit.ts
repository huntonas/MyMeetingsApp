import type { TagSubmissionRequest, TagWriteResponse } from "@mymeetingapp/shared";
import { sql } from "drizzle-orm";

import { tagAudit } from "@/db/schema";
import { ApiError } from "@/lib/api/respond";
import { consumeDailyLimit } from "@/server/devices/rate-limit";
import { writeAsDevice, type WriteDevice } from "@/server/devices/write-request";
import { meetingTagCounts, recountTags } from "@/server/tags/counts";
import { findOwnSubmissions, saveOwnSubmission } from "@/server/tags/own-submissions";
import { flagTagSwings } from "@/server/tags/swings";
import { findTaggableMeeting } from "@/server/tags/taggable-meeting";
import { validTagIds } from "@/server/tags/tag-ids";

// Spec §5: a new submission, or a re-confirmation at least 7 days after the device's last one, inside the tagging
// window and within the daily cap. One transaction covers the row, the audit row and the recount, so the response
// already includes this submission.
export async function submitTags(
  device: WriteDevice,
  request: TagSubmissionRequest,
): Promise<TagWriteResponse> {
  return writeAsDevice(device, async (tx) => {
    const meeting = await findTaggableMeeting(request.meetingId, tx);
    if (meeting.archived) throw new ApiError("meeting_not_found");
    if (meeting.tagsDisabled) throw new ApiError("tags_disabled");
    const tagIds = await validTagIds(request.tags, tx);
    const own = await findOwnSubmissions(device.deviceHash, meeting.id, tx);
    if (own[0]?.confirmedThisWeek === true) throw new ApiError("already_tagged");
    if (!meeting.windowOpen) throw new ApiError("window_closed");
    await consumeDailyLimit(device.deviceHash, "tag_submission", tx);
    // Spec §5: nearMeeting is always false for online attendance.
    const nearMeeting = !meeting.online && request.nearMeeting === true;
    await saveOwnSubmission(
      device.deviceHash,
      meeting.id,
      own,
      { tagIds, nearMeeting, confirmedAt: sql`now()` },
      tx,
    );
    await tx
      .insert(tagAudit)
      .values({ deviceHash: device.deviceHash, meetingId: meeting.id, action: "submit" });
    await recountTags([meeting.id], tx);
    await flagTagSwings(meeting.id, tx);
    return { meetingId: meeting.id, tags: await meetingTagCounts(meeting.id, tx) };
  });
}
