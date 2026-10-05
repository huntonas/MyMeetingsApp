import { asc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { feeds, WAITING_REASONS, type WaitingReason } from "@/db/schema";
import { FormId } from "@/server/admin/form-fields";
import type { AdminNotice } from "@/server/admin/notices";

const NOTE_LIMIT = 2000;
const KEY_LIMIT = 200;

// A text field left blank (or only spaces) clears the value it holds.
const blankIsNull = (schema: z.ZodType<string, string>) =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(schema.nullable());

export const WaitForm = z.object({ feedId: FormId, reason: z.enum(WAITING_REASONS) });
export const ResumeForm = z.object({ feedId: FormId });
export const OutreachForm = z.object({
  feedId: FormId,
  contactEmail: blankIsNull(z.email()),
  contactedOn: blankIsNull(z.iso.date()),
  outreachNote: blankIsNull(z.string().max(NOTE_LIMIT)),
  accessKey: blankIsNull(z.string().max(KEY_LIMIT)),
});

export interface WaitingFeed {
  id: number;
  slug: string;
  name: string;
  state: string;
  url: string;
  waitingReason: WaitingReason | null;
  contactEmail: string | null;
  contactedOn: string | null;
  outreachNote: string | null;
  accessKey: string | null;
}

// Feeds are publishers, not people, and the contact is the office's own published address.
export async function listWaitingFeeds(): Promise<WaitingFeed[]> {
  return db
    .select({
      id: feeds.id,
      slug: feeds.slug,
      name: feeds.name,
      state: feeds.state,
      url: feeds.url,
      waitingReason: feeds.waitingReason,
      contactEmail: feeds.contactEmail,
      contactedOn: feeds.contactedOn,
      outreachNote: feeds.outreachNote,
      accessKey: feeds.accessKey,
    })
    .from(feeds)
    .where(isNotNull(feeds.waitingReason))
    .orderBy(asc(feeds.state), asc(feeds.name));
}

// Spec §4: a feed we can't read until its office lets us in. The sync stops asking for it.
export async function waitForPermission(input: z.output<typeof WaitForm>): Promise<AdminNotice> {
  const updated = await db
    .update(feeds)
    .set({ waitingReason: input.reason })
    .where(eq(feeds.id, input.feedId))
    .returning({ id: feeds.id });
  return updated.length === 0 ? "feed_not_found" : "feed_waiting";
}

export async function saveOutreach(input: z.output<typeof OutreachForm>): Promise<AdminNotice> {
  const { feedId, ...outreach } = input;
  const updated = await db
    .update(feeds)
    .set(outreach)
    .where(eq(feeds.id, feedId))
    .returning({ id: feeds.id });
  return updated.length === 0 ? "feed_not_found" : "outreach_saved";
}

// The office said yes. Clearing the attempt and success makes the feed due at the next sync, and the outreach stays
// as the record of who agreed.
export async function resumeFeed(input: z.output<typeof ResumeForm>): Promise<AdminNotice> {
  const updated = await db
    .update(feeds)
    .set({ waitingReason: null, lastAttemptAt: null, lastSuccessAt: null, lastError: null })
    .where(eq(feeds.id, input.feedId))
    .returning({ id: feeds.id });
  return updated.length === 0 ? "feed_not_found" : "feed_resumed";
}
