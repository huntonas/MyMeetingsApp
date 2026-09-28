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

// Every meeting id a device's submitter id on this meeting may have been computed with: its own id, and each id
// merged into it.
export async function submitterScopes(meetingId: string, executor: Executor): Promise<string[]> {
  const aliases = await executor
    .select({ id: meetingAliases.oldMeetingId })
    .from(meetingAliases)
    .where(eq(meetingAliases.meetingId, meetingId));
  return [meetingId, ...aliases.map((alias) => alias.id)];
}
