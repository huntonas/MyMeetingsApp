import { type SQL, sql } from "drizzle-orm";

const SAME_PLACE_METERS = 50;
const SAME_NAME_METERS = 150;
const MIN_CONTAINED_NAME_LENGTH = 4;
const MIN_NAME_SIMILARITY = 0.5;

// One side of a match: a canonical meeting, or a feed row about to become or join one. `listings` is a
// subquery of the listings that describe it, with the columns address_key, attendance, conference_key, name.
export interface MatchSide {
  day: SQL;
  time: SQL;
  location: SQL;
  listings: SQL;
}

// A stored canonical meeting, referenced by its alias in the surrounding query.
export function meetingSide(alias: string): MatchSide {
  const meeting = sql.raw(alias);
  return {
    day: sql`${meeting}.day`,
    time: sql`${meeting}.time`,
    location: sql`${meeting}.location`,
    listings: sql`(select address_key, attendance, conference_key, name from feed_meetings
      where meeting_id = ${meeting}.id)`,
  };
}

// "The Rockaway Big Book Group" and "ROCKAWAY BIG BOOK" both become "rockawaybigbook". Periods and
// apostrophes go first so "A.A." is the word "aa" and "Men's" stays one word.
function normalizedName(name: SQL): SQL {
  return sql`regexp_replace(
    regexp_replace(regexp_replace(lower(${name}), '[.''’]', '', 'g'),
      '[[:<:]](group|grupo|the|aa|meeting)[[:>:]]', '', 'g'),
    '[^[:alnum:]]', '', 'g')`;
}

// Spec §3 matching, shared by a new row joining a meeting and two stored meetings merging, so both follow
// the same rules: the same day and start time, plus coordinates within 50 m, the same normalized address,
// the same conference key when both are online or hybrid, or coordinates within 150 m and names that
// clearly match (one contains the other, or they are trigram-similar).
export function sidesMatch(a: MatchSide, b: MatchSide): SQL {
  return sql`(${a.day} = ${b.day} and ${a.time} = ${b.time} and (
    coalesce(ST_DWithin(${a.location}, ${b.location}, ${SAME_PLACE_METERS}), false)
    or exists (
      select 1 from ${a.listings} a_listing, ${b.listings} b_listing
      where a_listing.address_key = b_listing.address_key
        or (a_listing.attendance in ('online', 'hybrid') and b_listing.attendance in ('online', 'hybrid')
          and a_listing.conference_key = b_listing.conference_key)
    )
    or (coalesce(ST_DWithin(${a.location}, ${b.location}, ${SAME_NAME_METERS}), false) and exists (
      select 1 from ${a.listings} a_listing, ${b.listings} b_listing,
        lateral (select ${normalizedName(sql`a_listing.name`)} as a_name,
          ${normalizedName(sql`b_listing.name`)} as b_name) names
      where (least(length(names.a_name), length(names.b_name)) >= ${MIN_CONTAINED_NAME_LENGTH}
          and (strpos(names.a_name, names.b_name) > 0 or strpos(names.b_name, names.a_name) > 0))
        or similarity(names.a_name, names.b_name) >= ${MIN_NAME_SIMILARITY}
    ))
  ))`;
}
