import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { feedMeetings, feeds, meetings } from "@/db/schema";
import { FormBoolean, FormId } from "@/server/admin/form-fields";
import type { AdminNotice } from "@/server/admin/notices";
import { primarySourceJoin } from "@/server/meetings/summary";

const SEARCH_LIMIT = 25;

export const MeetingOptOutForm = z.object({ meetingId: z.uuid(), tagsDisabled: FormBoolean });
export const FeedOptOutForm = z.object({ feedId: FormId, optedOut: FormBoolean });

export interface MeetingMatch {
  id: string;
  name: string;
  day: number;
  time: string;
  address: string | null;
  tagsDisabled: boolean;
}

export interface FeedMatch {
  id: number;
  slug: string;
  name: string;
  state: string;
  optedOut: boolean;
}

// What the owner typed, matched anywhere, with LIKE's own wildcards taken literally.
function containing(query: string): string {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

const meetingColumns = {
  id: meetings.id,
  name: feedMeetings.name,
  day: meetings.day,
  time: meetings.time,
  address: feedMeetings.formattedAddress,
  tagsDisabled: meetings.tagsDisabled,
};

// A group asks by name, day, time and address (the support page says so), so this matches the meeting's name, its
// group's name or its address. Meetings aren't people, so listing them is fine.
export async function findMeetings(query: string): Promise<MeetingMatch[]> {
  const pattern = containing(query);
  return db
    .select(meetingColumns)
    .from(meetings)
    .innerJoin(feedMeetings, primarySourceJoin)
    .where(
      and(
        isNull(meetings.archivedAt),
        or(
          ilike(feedMeetings.name, pattern),
          ilike(feedMeetings.groupName, pattern),
          ilike(feedMeetings.formattedAddress, pattern),
        ),
      ),
    )
    .orderBy(asc(feedMeetings.name), asc(meetings.day), asc(meetings.time))
    .limit(SEARCH_LIMIT);
}

export async function listTagOptOuts(): Promise<MeetingMatch[]> {
  return db
    .select(meetingColumns)
    .from(meetings)
    .innerJoin(feedMeetings, primarySourceJoin)
    .where(eq(meetings.tagsDisabled, true))
    .orderBy(asc(feedMeetings.name), asc(meetings.day), asc(meetings.time));
}

// Spec §3: a group that asked not to be tagged. No tag is accepted or shown while this is set. Its rows stay, so
// turning tags back on shows the counts again.
export async function setMeetingTagsDisabled(
  input: z.output<typeof MeetingOptOutForm>,
): Promise<AdminNotice> {
  const updated = await db
    .update(meetings)
    .set({ tagsDisabled: input.tagsDisabled })
    .where(eq(meetings.id, input.meetingId))
    .returning({ id: meetings.id });
  if (updated.length === 0) return "meeting_not_found";
  return input.tagsDisabled ? "tags_turned_off" : "tags_turned_on";
}

const feedColumns = {
  id: feeds.id,
  slug: feeds.slug,
  name: feeds.name,
  state: feeds.state,
  optedOut: feeds.optedOut,
};

// An entity writes with its website, so the feed's address is searched too.
export async function findFeeds(query: string): Promise<FeedMatch[]> {
  const pattern = containing(query);
  return db
    .select(feedColumns)
    .from(feeds)
    .where(or(ilike(feeds.name, pattern), ilike(feeds.slug, pattern), ilike(feeds.url, pattern)))
    .orderBy(asc(feeds.name))
    .limit(SEARCH_LIMIT);
}

export async function listOptedOutFeeds(): Promise<FeedMatch[]> {
  return db.select(feedColumns).from(feeds).where(eq(feeds.optedOut, true)).orderBy(asc(feeds.name));
}

// Spec §3 and §4: an entity that asked us to stop using its feed. The next sync (every 15 minutes) archives its
// meetings. Opting back in makes the feed due at once.
export async function setFeedOptedOut(input: z.output<typeof FeedOptOutForm>): Promise<AdminNotice> {
  const updated = await db
    .update(feeds)
    .set(input.optedOut ? { optedOut: true } : { optedOut: false, lastSuccessAt: null, lastAttemptAt: null })
    .where(eq(feeds.id, input.feedId))
    .returning({ id: feeds.id });
  if (updated.length === 0) return "feed_not_found";
  return input.optedOut ? "feed_opted_out" : "feed_opted_in";
}
