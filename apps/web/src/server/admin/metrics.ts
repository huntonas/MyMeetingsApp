import { and, asc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  devices,
  feeds,
  meetings,
  suggestions,
  tagCounts,
  tagSubmissions,
  tagSwings,
  tags,
} from "@/db/schema";
import { utcToday } from "@/db/sql";
import { FEED_OVERDUE_AFTER } from "@/server/sync/run-sync";

const ERROR_SHOWN = 300;
const TOP_TAGS = 10;
const DAYS_CHARTED = 14;

interface Metrics {
  devices: { active7: number; active30: number; ios: number; android: number; blocked: number };
  tagging: {
    submissionsThisWeek: number;
    nearMeetingThisWeek: number;
    meetings: number;
    meetingsWithTags: number;
  };
  submissionsPerDay: { day: string; count: number }[];
  topTags: { label: string; submissions: number }[];
  vocabulary: { active: number; retired: number };
  pendingSuggestions: number;
  openSwings: number;
  feeds: { total: number; optedOut: number; waiting: number; needingAttention: number };
}

interface FeedAttention {
  id: number;
  slug: string;
  name: string;
  state: string;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
}

// Extends Record so db.execute accepts it as a row type.
interface Totals extends Record<string, number> {
  active7: number;
  active30: number;
  ios: number;
  android: number;
  blocked: number;
  submissionsThisWeek: number;
  nearMeetingThisWeek: number;
  meetings: number;
  meetingsWithTags: number;
  activeTags: number;
  retiredTags: number;
  pendingSuggestions: number;
  openSwings: number;
  feeds: number;
  optedOutFeeds: number;
  waitingFeeds: number;
  feedsNeedingAttention: number;
}

// Owner decision 1: a feed needs attention when its last attempt failed, or when it has been tried but hasn't
// succeeded for longer than the weekly sync plus the one-day retry. Opted-out and waiting feeds are never synced.
const needsAttention = and(
  eq(feeds.optedOut, false),
  isNull(feeds.waitingReason),
  or(
    isNotNull(feeds.lastError),
    and(
      isNotNull(feeds.lastAttemptAt),
      or(isNull(feeds.lastSuccessAt), lt(feeds.lastSuccessAt, sql`now() - ${FEED_OVERDUE_AFTER}`)),
    ),
  ),
);

const thisWeek = sql`not ${tagSubmissions.excluded} and ${tagSubmissions.confirmedAt} > now() - interval '7 days'`;

// Spec §10: every figure is a count over many rows. Nothing here returns a row about one device.
async function readTotals(): Promise<Totals> {
  const { rows } = await db.execute<Totals>(sql`
    select
      (select count(*)::int from ${devices} where ${devices.lastSeenDate} >= ${utcToday} - 6) as "active7",
      (select count(*)::int from ${devices} where ${devices.lastSeenDate} >= ${utcToday} - 29) as "active30",
      (select count(*)::int from ${devices} where ${devices.platform} = 'ios') as "ios",
      (select count(*)::int from ${devices} where ${devices.platform} = 'android') as "android",
      (select count(*)::int from ${devices} where ${devices.blocked}) as "blocked",
      (select count(*)::int from ${tagSubmissions} where ${thisWeek}) as "submissionsThisWeek",
      (select count(*)::int from ${tagSubmissions} where ${thisWeek} and ${tagSubmissions.nearMeeting})
        as "nearMeetingThisWeek",
      (select count(*)::int from ${meetings} where ${meetings.archivedAt} is null) as "meetings",
      (select count(distinct ${tagCounts.meetingId})::int from ${tagCounts}
        join ${meetings} on ${meetings.id} = ${tagCounts.meetingId} where ${meetings.archivedAt} is null)
        as "meetingsWithTags",
      (select count(*)::int from ${tags} where ${tags.status} = 'active') as "activeTags",
      (select count(*)::int from ${tags} where ${tags.status} = 'retired') as "retiredTags",
      (select count(*)::int from ${suggestions} where ${suggestions.status} = 'pending') as "pendingSuggestions",
      (select count(*)::int from ${tagSwings} where ${tagSwings.reviewedAt} is null) as "openSwings",
      (select count(*)::int from ${feeds}) as "feeds",
      (select count(*)::int from ${feeds} where ${feeds.optedOut}) as "optedOutFeeds",
      (select count(*)::int from ${feeds} where ${feeds.waitingReason} is not null) as "waitingFeeds",
      (select count(*)::int from ${feeds} where ${needsAttention}) as "feedsNeedingAttention"
  `);
  const [totals] = rows;
  if (totals === undefined) throw new Error("the totals query returned no row");
  return totals;
}

// By UTC date of each row's latest confirmation, with days that had none included.
async function readSubmissionsPerDay(): Promise<{ day: string; count: number }[]> {
  const { rows } = await db.execute<{ day: string; count: number }>(sql`
    select to_char(day, 'YYYY-MM-DD') as "day", count(${tagSubmissions.submitterId})::int as "count"
    from generate_series(
      (${utcToday} - ${DAYS_CHARTED - 1}::int)::timestamp, ${utcToday}::timestamp, interval '1 day'
    ) as day
    left join ${tagSubmissions}
      on (${tagSubmissions.confirmedAt} at time zone 'utc')::date = day::date and not ${tagSubmissions.excluded}
    group by day
    order by day
  `);
  return rows;
}

async function readTopTags(): Promise<{ label: string; submissions: number }[]> {
  const { rows } = await db.execute<{ label: string; submissions: number }>(sql`
    select t.label as "label", count(*)::int as "submissions"
    from ${tagSubmissions} s cross join lateral unnest(s.tag_ids) as tag_id join ${tags} t on t.id = tag_id
    where not s.excluded and s.confirmed_at > now() - interval '30 days'
    group by t.id, t.label
    order by "submissions" desc, t.label
    limit ${TOP_TAGS}
  `);
  return rows;
}

export async function readMetrics(): Promise<Metrics> {
  const [totals, submissionsPerDay, topTags] = await Promise.all([
    readTotals(),
    readSubmissionsPerDay(),
    readTopTags(),
  ]);
  return {
    devices: {
      active7: totals.active7,
      active30: totals.active30,
      ios: totals.ios,
      android: totals.android,
      blocked: totals.blocked,
    },
    tagging: {
      submissionsThisWeek: totals.submissionsThisWeek,
      nearMeetingThisWeek: totals.nearMeetingThisWeek,
      meetings: totals.meetings,
      meetingsWithTags: totals.meetingsWithTags,
    },
    submissionsPerDay,
    topTags,
    vocabulary: { active: totals.activeTags, retired: totals.retiredTags },
    pendingSuggestions: totals.pendingSuggestions,
    openSwings: totals.openSwings,
    feeds: {
      total: totals.feeds,
      optedOut: totals.optedOutFeeds,
      waiting: totals.waitingFeeds,
      needingAttention: totals.feedsNeedingAttention,
    },
  };
}

// Spec §10 and §14: per-feed sync health. Feeds are publishers, not people. An error is cut short so a feed that
// answered with a whole HTML page can't swamp the page.
export async function readFeedsNeedingAttention(): Promise<FeedAttention[]> {
  return db
    .select({
      id: feeds.id,
      slug: feeds.slug,
      name: feeds.name,
      state: feeds.state,
      lastAttemptAt: feeds.lastAttemptAt,
      lastSuccessAt: feeds.lastSuccessAt,
      lastError: sql<string | null>`left(${feeds.lastError}, ${ERROR_SHOWN}::int)`,
    })
    .from(feeds)
    .where(needsAttention)
    .orderBy(sql`${feeds.lastSuccessAt} asc nulls first`, asc(feeds.slug));
}
