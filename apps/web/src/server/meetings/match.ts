import { type SQL, sql } from "drizzle-orm";

import { sqlStringList } from "@/db/sql";

const SAME_PLACE_METERS = 50;
const SAME_NAME_METERS = 150;
const MIN_CONTAINED_NAME_LENGTH = 4;
const MIN_NAME_SIMILARITY = 0.5;

// One side of a match: a canonical meeting, or a feed row about to become or join one. `listings` is a
// subquery of the listings that describe it, with the columns address_key, attendance, conference_key, name,
// types, feed_id, source_slug and archived_at. `fellowship` is the fellowship of the meeting or feed it comes from.
export interface MatchSide {
  fellowship: SQL;
  day: SQL;
  time: SQL;
  location: SQL;
  listings: SQL;
}

// A stored canonical meeting, referenced by its alias in the surrounding query.
export function meetingSide(alias: string): MatchSide {
  const meeting = sql.raw(alias);
  return {
    fellowship: sql`${meeting}.fellowship`,
    day: sql`${meeting}.day`,
    time: sql`${meeting}.time`,
    location: sql`${meeting}.location`,
    listings: sql`(select address_key, attendance, conference_key, name, types, feed_id, source_slug, archived_at
      from feed_meetings where meeting_id = ${meeting}.id)`,
  };
}

// Which genders a listing is for, from name words (English and Spanish) and the Meeting Guide M and W types,
// in one vocabulary so "Men's" in a name and the M type mean the same. A men's and a women's meeting never
// join by place or name. Other audiences (young people, LGBTQ, seniors, Spanish) don't veto a match: feeds tag
// them too inconsistently.
const GENDER_TERMS: Record<string, readonly string[]> = {
  men: [
    "men",
    "mens",
    "man",
    "guys",
    "brothers",
    "gentlemen",
    "hombres",
    "caballeros",
    "varones",
    "male",
    "type_m",
  ],
  women: [
    "women",
    "womens",
    "woman",
    "ladies",
    "lady",
    "sisters",
    "girls",
    "gals",
    "damas",
    "mujeres",
    "female",
    "type_w",
  ],
};
const GENDER_ENTRIES = Object.entries(GENDER_TERMS).flatMap(([gender, terms]) =>
  terms.map((term) => [term, gender] as const),
);
// Inline constants rather than bound parameters, so each use adds no parameters to the query.
const GENDER_KEYS = sql`array[${sqlStringList(GENDER_ENTRIES.map(([term]) => term))}]`;
const GENDER_VALUES = sql`array[${sqlStringList(GENDER_ENTRIES.map(([, gender]) => gender))}]`;

// One stored listing as a side of its own, referenced by its feed_meetings alias, so the split pass can ask
// whether two listings on one meeting match by the same rules. Its location is its own coordinates, or else
// its address's geocode.
export function listingSide(alias: string): MatchSide {
  const listing = sql.raw(alias);
  return {
    fellowship: sql`(select feed.fellowship from feeds feed where feed.id = ${listing}.feed_id)`,
    day: sql`${listing}.day`,
    time: sql`${listing}.time`,
    location: sql`coalesce(
      ST_SetSRID(ST_MakePoint(${listing}.longitude, ${listing}.latitude), 4326)::geography,
      (select ST_SetSRID(ST_MakePoint(geocode.longitude, geocode.latitude), 4326)::geography
        from address_geocodes geocode
        where geocode.address_key = ${listing}.address_key and geocode.status = 'matched'))`,
    listings: sql`(select ${listing}.address_key, ${listing}.attendance, ${listing}.conference_key, ${listing}.name,
      ${listing}.types, ${listing}.feed_id, ${listing}.source_slug, ${listing}.archived_at)`,
  };
}

// "The Rockaway Big Book Group" and "ROCKAWAY BIG BOOK" both become {rockaway,big,book}. Accents fold first,
// so "Español" is "espanol" in any database locale. Periods and apostrophes go next so "A.A." is the word "aa"
// and "Men's" is "mens"; any other run of characters that aren't ASCII letters or digits separates words.
function nameWords(name: SQL): SQL {
  return sql`string_to_array(btrim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(translate(${name}, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[.''’]', '', 'g'),
      '[[:<:]](group|grupo|the|aa|meeting)[[:>:]]', ' ', 'g'),
    '[^a-z0-9]+', ' ', 'g')), ' ')`;
}

function gender(words: SQL, types: SQL): SQL {
  return sql`array(select distinct (${GENDER_VALUES})[array_position(${GENDER_KEYS}, term)]
    from unnest(${words} || array(select 'type_' || lower(code) from unnest(${types}) code)) term
    where term = any(${GENDER_KEYS})
    order by 1)`;
}

// Every word of one name appears in the other, and those words have at least 4 letters between them.
function wordsContained(shorter: SQL, longer: SQL): SQL {
  return sql`(${shorter} <@ ${longer}
    and length(array_to_string(${shorter}, '')) >= ${MIN_CONTAINED_NAME_LENGTH})`;
}

// Each listing's genders, one row per listing of the side: {men}, {women}, {men,women} for a listing that
// names both, or {} for one that names neither.
function listingGenders(side: MatchSide): SQL {
  return sql`(select ${gender(nameWords(sql`listing.name`), sql`listing.types`)} genders
    from ${side.listings} listing)`;
}

// The genders a side's listings name, or null when none names any. Listings that name none don't count, so
// an untyped listing never makes a side mixed or blocks a match.
function sideGenders(side: MatchSide): SQL {
  return sql`(select genders from ${listingGenders(side)} named where cardinality(genders) > 0
    order by genders limit 1)`;
}

// A stored meeting whose listings already name different genders (a men's and a women's listing merged by
// an older rule) never matches, so it can't absorb more listings or merge further.
function mixedGenders(side: MatchSide): SQL {
  return sql`((select count(distinct genders) from ${listingGenders(side)} named
    where cardinality(genders) > 0) > 1)`;
}

// Two listings share a conference when they have the same conference key, unless both sides have a location
// and those are more than 150 m apart: hybrid meetings at two venues can share one Zoom link, and merging them
// would hide a venue. An online-only side has no location, so its key alone decides.
function sharedConference(a: MatchSide, b: MatchSide, aListing: SQL, bListing: SQL): SQL {
  return sql`coalesce(${aListing}.conference_key = ${bListing}.conference_key
    and coalesce(ST_DWithin(${a.location}, ${b.location}, ${SAME_NAME_METERS}), true), false)`;
}

// Spec §3 matching, shared by a new row joining a meeting and two stored meetings merging, so both follow
// the same rules: the same day and start time, plus a shared conference when both are online or hybrid,
// or, unless both sides name a gender and they differ, coordinates within 50 m, the same normalized
// address, or coordinates within 150 m and names that clearly match (every word of one is in the other, or
// they are trigram-similar). A side whose own listings name different genders never matches. Callers first
// narrow the meetings to check with matchCandidates. Meetings of different fellowships never match, however alike.
export function sidesMatch(a: MatchSide, b: MatchSide): SQL {
  return sql`(${a.fellowship} = ${b.fellowship} and ${a.day} = ${b.day} and ${a.time} = ${b.time}
    and not ${mixedGenders(a)} and not ${mixedGenders(b)} and (
    exists (
      select 1 from ${a.listings} a_listing, ${b.listings} b_listing
      where a_listing.attendance in ('online', 'hybrid') and b_listing.attendance in ('online', 'hybrid')
        and ${sharedConference(a, b, sql`a_listing`, sql`b_listing`)}
    )
    or (coalesce(${sideGenders(a)} = ${sideGenders(b)}, true) and exists (
      select 1 from ${a.listings} a_listing, ${b.listings} b_listing,
        lateral (select ${nameWords(sql`a_listing.name`)} a_words, ${nameWords(sql`b_listing.name`)} b_words) names
      where coalesce(ST_DWithin(${a.location}, ${b.location}, ${SAME_PLACE_METERS}), false)
        or a_listing.address_key = b_listing.address_key
        or (coalesce(ST_DWithin(${a.location}, ${b.location}, ${SAME_NAME_METERS}), false) and (
          ${wordsContained(sql`names.a_words`, sql`names.b_words`)}
          or ${wordsContained(sql`names.b_words`, sql`names.a_words`)}
          or similarity(array_to_string(names.a_words, ' '), array_to_string(names.b_words, ' '))
            >= ${MIN_NAME_SIMILARITY}
        ))
    ))
  ))`;
}

// The ids of meetings that could match a side, each found by an index: the same day and time within 150 m
// (gist), or a listing on that day with the same address key or conference key. Every sidesMatch rule
// needs one of these, so new-row matching and the merge pass check sidesMatch only on these candidates.
export function matchCandidates(side: MatchSide): SQL {
  return sql`
    select other.id candidate_id from meetings other
    where other.day = ${side.day} and other.time = ${side.time}
      and ST_DWithin(other.location, ${side.location}, ${SAME_NAME_METERS})
    union
    select other_listing.meeting_id from ${side.listings} listing
    join feed_meetings other_listing on other_listing.address_key = listing.address_key
      and other_listing.day = ${side.day}
    union
    select other_listing.meeting_id from ${side.listings} listing
    join feed_meetings other_listing on other_listing.conference_key = listing.conference_key
      and other_listing.day = ${side.day}`;
}

// One feed listing the two sides under different slugs means two rooms at one address and time, so they
// never join, unless those listings share a conference (sharedConference), which makes them one meeting.
// - "active" (new-row matching) counts only listings the feed lists now. applyFeedSnapshot sets this feed's
//   archived_at from the snapshot before matching, so a slug the feed renamed doesn't hold on to its meeting.
// - "ever-listed" (merge pass) also counts archived listings. A feed that drops one room from one snapshot
//   still has two rooms, so the room it dropped mustn't merge into the other and stay there when it returns.
export function sameFeedConflict(a: MatchSide, b: MatchSide, listings: "active" | "ever-listed"): SQL {
  const active =
    listings === "active" ? sql`and a_listing.archived_at is null and b_listing.archived_at is null` : sql``;
  return sql`exists (
    select 1 from ${a.listings} a_listing, ${b.listings} b_listing
    where a_listing.feed_id = b_listing.feed_id and a_listing.source_slug <> b_listing.source_slug ${active}
      and not ${sharedConference(a, b, sql`a_listing`, sql`b_listing`)}
  )`;
}
