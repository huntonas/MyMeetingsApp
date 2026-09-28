import { eq } from "drizzle-orm";

import { db, type Executor } from "@/db/client";
import { meetingAliases } from "@/db/schema";

// An id the app saved before its meeting merged into another resolves to the surviving meeting.
export async function resolveMeetingId(id: string, executor: Executor = db): Promise<string> {
  const [alias] = await executor
    .select({ meetingId: meetingAliases.meetingId })
    .from(meetingAliases)
    .where(eq(meetingAliases.oldMeetingId, id));
  return alias?.meetingId ?? id;
}
