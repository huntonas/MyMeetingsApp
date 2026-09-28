import { type SQL, sql } from "drizzle-orm";

import { sqlStringList } from "@/db/sql";

const SAME_PLACE_METERS = 50;
const SAME_NAME_METERS = 150;
const MIN_CONTAINED_NAME_LENGTH = 4;
const MIN_NAME_SIMILARITY = 0.5;

// One side of a match: a canonical meeting, or a feed row about to become or join one. `listings` is a
// subquery of the listings that describe it, with the columns address_key, attendance, conference_key, name,
// types, feed_id, source_slug and archived_at.
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
    listings: sql`(select address_key, attendance, conference_key, name, types, feed_id, source_slug, archived_at
      from feed_meetings where meeting_id = ${meeting}.id)`,
  };
}

// Who a meeting is for, from name words and Meeting Guide type codes, in one vocabulary so "Men's" in a name
// and the M type are the same audience. Sides that both name an audience and differ never join by place or
// name, so a men's and a women's meeting at one place and time stay apart. SP is Speaker in Meeting Guide,
// not Spanish.
const AUDIENCE_TERMS: Record<string, readonly string[]> = {
  men: [
    "men",
    "mens",
    "man",
    "guys",
    "brothers",
    "gentlemen",
    "stag",
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
  gay: ["gay", "type_g"],
  lesbian: ["lesbian", "type_l"],
  lgbtq: ["lgbt", "lgbtq", "queer", "type_lgbtq"],
  trans: ["trans", "transgender", "type_t"],
  young: ["young", "youth", "type_y"],
  senior: ["senior", "seniors", "type_sen"],
  spanish: ["spanish", "espanol", "type_s"],
};
const AUDIENCE_ENTRIES = Object.entries(AUDIENCE_TERMS).flatMap(([audience, terms]) =>
  terms.map((term) => [term, audience] as const),
);
// Inline constants rather than bound parameters, so each use adds no parameters to the query.
const AUDIENCE_KEYS = sql`array[${sqlStringList(AUDIENCE_ENTRIES.map(([term]) => term))}]`;
const AUDIENCE_VALUES = sql`array[${sqlStringList(AUDIENCE_ENTRIES.map(([, audience]) => audience))}]`;

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

function audience(words: SQL, types: SQL): SQL {
  return sql`array(select distinct (${AUDIENCE_VALUES})[array_position(${AUDIENCE_KEYS}, term)]
    from unnest(${words} || array(select 'type_' || lower(code) from unnest(${types}) code)) term
    where term = any(${AUDIENCE_KEYS})
    order by 1)`;
}

// Every word of one name appears in the other, and those words have at least 4 letters between them.
function wordsContained(shorter: SQL, longer: SQL): SQL {
  return sql`(${shorter} <@ ${longer}
    and length(array_to_string(${shorter}, '')) >= ${MIN_CONTAINED_NAME_LENGTH})`;
}

// Each listing's audience, one row per listing of the side.
function listingAudiences(side: MatchSide): SQL {
  return sql`(select ${audience(nameWords(sql`listing.name`), sql`listing.types`)} audience
    from ${side.listings} listing)`;
}

// The one audience a side's listings name, or null when none names one. Listings that name no audience
// don't count, so an untyped listing never makes a side mixed or blocks a match.
function sideAudience(side: MatchSide): SQL {
  return sql`(select audience from ${listingAudiences(side)} named where cardinality(audience) > 0
    order by audience limit 1)`;
}

// A stored meeting whose listings already name different audiences (a men's and a women's listing merged
// by an older rule) never matches, so it can't absorb more listings or merge further.
function mixedAudience(side: MatchSide): SQL {
  return sql`((select count(distinct audience) from ${listingAudiences(side)} named
    where cardinality(audience) > 0) > 1)`;
}

// Spec §3 matching, shared by a new row joining a meeting and two stored meetings merging, so both follow
// the same rules: the same day and start time, plus the same conference key when both are online or hybrid,
// or, unless both sides name an audience and they differ, coordinates within 50 m, the same normalized
// address, or coordinates within 150 m and names that clearly match (every word of one is in the other, or
// they are trigram-similar). A side whose own listings name different audiences never matches. Callers first
// narrow the meetings to check with matchCandidates.
export function sidesMatch(a: MatchSide, b: MatchSide): SQL {
  return sql`(${a.day} = ${b.day} and ${a.time} = ${b.time}
    and not ${mixedAudience(a)} and not ${mixedAudience(b)} and (
    exists (
      select 1 from ${a.listings} a_listing, ${b.listings} b_listing
      where a_listing.attendance in ('online', 'hybrid') and b_listing.attendance in ('online', 'hybrid')
        and a_listing.conference_key = b_listing.conference_key
    )
    or (coalesce(${sideAudience(a)} = ${sideAudience(b)}, true) and exists (
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
// never join, unless those listings share a conference key, which makes them one meeting.
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
      and not coalesce(a_listing.conference_key = b_listing.conference_key, false)
  )`;
}
