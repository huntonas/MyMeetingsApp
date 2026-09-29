import type { TagEditRequest, TagWriteResponse } from "@mymeetingapp/shared";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import { tagAudit, tagSubmissions } from "@/db/schema";
import { ApiError } from "@/lib/api/respond";
import { lockDevice, recordDevice, type WriteDevice } from "@/server/devices/write-request";
import { meetingTagCounts, recountTags } from "@/server/tags/counts";
import { findOwnSubmissions, saveOwnSubmission } from "@/server/tags/own-submissions";
import { findTaggableMeeting } from "@/server/tags/taggable-meeting";
import { validTagIds } from "@/server/tags/tag-ids";

// Spec §5: edits are allowed at any time, keep the original confirmed_at and near_meeting, and don't count toward
// the daily cap. When the device holds two rows (it tagged two copies that merged), the newest confirmation's
// values are kept and the rows become one.
export async function editTags(
  device: WriteDevice,
  requestedId: string,
  request: TagEditRequest,
): Promise<TagWriteResponse> {
  return db.transaction(async (tx) => {
    await recordDevice(device, tx);
    const meeting = await findTaggableMeeting(requestedId, tx);
    if (meeting.tagsDisabled) throw new ApiError("tags_disabled");
    const tagIds = await validTagIds(request.tags, tx);
    const own = await findOwnSubmissions(device.deviceHash, meeting.id, tx);
    const latest = own[0];
    if (latest === undefined) throw new ApiError("not_tagged");
    await saveOwnSubmission(
      device.deviceHash,
      meeting.id,
      own,
      { tagIds, nearMeeting: latest.nearMeeting, confirmedAt: latest.confirmedAt },
      tx,
    );
    await tx
      .insert(tagAudit)
      .values({ deviceHash: device.deviceHash, meetingId: meeting.id, action: "edit" });
    await recountTags([meeting.id], tx);
    return { meetingId: meeting.id, tags: await meetingTagCounts(meeting.id, tx) };
  });
}

// Spec §5: deletes are allowed at any time: while tagging is switched off, on an opted-out or archived meeting,
// and for a blocked device. The device's audit rows for the meeting go too, so a deletion leaves no link.
export async function deleteTags(device: WriteDevice, requestedId: string): Promise<TagWriteResponse> {
  return db.transaction(async (tx) => {
    await lockDevice(device.deviceHash, tx);
    const meeting = await findTaggableMeeting(requestedId, tx);
    const own = await findOwnSubmissions(device.deviceHash, meeting.id, tx);
    if (own.length === 0) throw new ApiError("not_tagged");
    await tx.delete(tagSubmissions).where(
      and(
        eq(tagSubmissions.meetingId, meeting.id),
        inArray(
          tagSubmissions.submitterId,
          own.map((row) => row.submitterId),
        ),
      ),
    );
    await tx
      .delete(tagAudit)
      .where(and(eq(tagAudit.deviceHash, device.deviceHash), eq(tagAudit.meetingId, meeting.id)));
    await recountTags([meeting.id], tx);
    return { meetingId: meeting.id, tags: await meetingTagCounts(meeting.id, tx) };
  });
}
