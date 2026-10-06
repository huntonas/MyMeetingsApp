import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { feedMeetings, feeds, meetings } from "@/db/schema";
import { upsertFeed } from "@/db/upsert-feed";
import type { FeedMeeting } from "@/server/feeds/normalize";

export function feedMeeting(overrides: Partial<FeedMeeting> = {}): FeedMeeting {
  return {
    sourceSlug: "nooners",
    day: 1,
    time: "12:00",
    endTime: null,
    timezone: "America/Chicago",
    name: "Nooners",
    types: ["O"],
    attendance: "in_person",
    locationName: "St. Luke's",
    formattedAddress: "1 Main St, Nashville, TN 37203, USA",
    addressKey: "1 main st nashville tn 37203",
    latitude: 36.17,
    longitude: -86.78,
    locationNotes: null,
    notes: null,
    groupName: null,
    conferenceUrl: null,
    conferenceUrlNotes: null,
    conferencePhone: null,
    conferencePhoneNotes: null,
    sourceUrl: null,
    ...overrides,
  };
}

export async function seedFeed(
  slug: string,
  entityType: "intergroup" | "area" | "region" = "intergroup",
  fellowship: "aa" | "na" = "aa",
) {
  return upsertFeed({
    slug,
    name: slug,
    entityType,
    state: "TN",
    url: `https://${slug}.example.org/feed`,
    fellowship,
  });
}

// Inserts one meeting with the given sources directly, for tests of code that runs after matching.
export async function insertMeetingWithSources(
  sources: { feedId: number; row: FeedMeeting; archived?: boolean }[],
) {
  // The meeting is its first source's feed's fellowship, as applyFeedSnapshot makes it.
  const [feed] = await db
    .select({ fellowship: feeds.fellowship })
    .from(feeds)
    .where(eq(feeds.id, sources[0]?.feedId ?? 0));
  const [meeting] = await db
    .insert(meetings)
    .values({
      day: sources[0]?.row.day ?? 1,
      time: sources[0]?.row.time ?? "12:00",
      fellowship: feed?.fellowship ?? "aa",
    })
    .returning();
  if (meeting === undefined) throw new Error("no meeting");
  for (const { feedId, row, archived } of sources) {
    await db.insert(feedMeetings).values({
      ...row,
      feedId,
      meetingId: meeting.id,
      seenAt: new Date(),
      archivedAt: archived === true ? new Date() : null,
    });
  }
  return meeting.id;
}
