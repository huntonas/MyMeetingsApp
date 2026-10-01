import type { TagWriteResponse } from "@mymeetingapp/shared";

import { savedCopy } from "@/cache/cached-read";
import { writeCache } from "@/cache/store";
import { detailRead } from "@/meetings/detail-read";

// A write's answer carries the meeting's fresh counts (spec §5). They go into the meeting's saved copy, which keeps
// its savedAt: the rest of the copy is no newer than it was, so the website's catch-up promises still hold. The copy
// takes the id the server answered for too: a merged meeting's moved copy still names the old id inside, and a copy
// must always name the meeting its key does. Best effort, like the cache itself.
export async function saveNewCounts(response: TagWriteResponse): Promise<void> {
  const read = detailRead(response.meetingId);
  const copy = await savedCopy(read);
  if (copy === null) return;
  await writeCache(
    read.key,
    { meeting: { ...copy.data.meeting, id: response.meetingId, tags: response.tags } },
    copy.savedAt,
  );
}
