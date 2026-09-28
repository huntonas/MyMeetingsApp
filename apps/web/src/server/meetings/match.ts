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

// Words that name who a meeting is for. Two names that differ in these never match, so a men's and a women's
// meeting at one place and time stay apart. Spelling variants of one word share a value.
const AUDIENCE_WORDS: Record<string, string> = {
  men: "men",
  mens: "men",
  women: "women",
  womens: "women",
  ladies: "ladies",
  gay: "gay",
  lesbian: "lesbian",
  lgbt: "lgbt",
  lgbtq: "lgbt",
  queer: "queer",
  young: "young",
  youth: "youth",
  senior: "senior",
  seniors: "senior",
  spanish: "spanish",
  espanol: "espanol",
  español: "espanol",
  hombres: "hombres",
  mujeres: "mujeres",
  closed: "closed",
  open: "open",
};

// "The Rockaway Big Book Group" and "ROCKAWAY BIG BOOK" both become "rockaway big book". Periods and
// apostrophes go first so "A.A." is the word "aa" and "Men's" is the word "mens"; any other run of
// non-alphanumerics separates words.
function nameWords(name: SQL): SQL {
  return sql`string_to_array(btrim(regexp_replace(
    regexp_replace(regexp_replace(lower(${name}), '[.''’]', '', 'g'),
      '[[:<:]](group|grupo|the|aa|meeting)[[:>:]]', ' ', 'g'),
    '[^[:alnum:]]+', ' ', 'g')), ' ')`;
}

function audience(words: SQL): SQL {
  const entries = Object.entries(AUDIENCE_WORDS).map(([word, value]) => sql`(${word}::text, ${value}::text)`);
  return sql`array(select distinct audience.value from unnest(${words}) name_word(word)
    join (values ${sql.join(entries, sql`, `)}) audience(word, value) on audience.word = name_word.word
    order by audience.value)`;
}

// Every word of one name appears in the other, and those words have at least 4 letters between them.
function wordsContained(shorter: SQL, longer: SQL): SQL {
  return sql`(${shorter} <@ ${longer}
    and length(array_to_string(${shorter}, '')) >= ${MIN_CONTAINED_NAME_LENGTH})`;
}

// Spec §3 matching, shared by a new row joining a meeting and two stored meetings merging, so both follow
// the same rules: the same day and start time, plus the same conference key when both are online or hybrid,
// or, for names that don't differ in audience words, coordinates within 50 m, the same normalized address,
// or coordinates within 150 m and names that clearly match (every word of one is in the other, or they are
// trigram-similar).
export function sidesMatch(a: MatchSide, b: MatchSide): SQL {
  return sql`(${a.day} = ${b.day} and ${a.time} = ${b.time} and (
    exists (
      select 1 from ${a.listings} a_listing, ${b.listings} b_listing
      where a_listing.attendance in ('online', 'hybrid') and b_listing.attendance in ('online', 'hybrid')
        and a_listing.conference_key = b_listing.conference_key
    )
    or exists (
      select 1 from ${a.listings} a_listing, ${b.listings} b_listing,
        lateral (select ${nameWords(sql`a_listing.name`)} a_words, ${nameWords(sql`b_listing.name`)} b_words) names
      where (
          coalesce(ST_DWithin(${a.location}, ${b.location}, ${SAME_PLACE_METERS}), false)
          or a_listing.address_key = b_listing.address_key
          or (coalesce(ST_DWithin(${a.location}, ${b.location}, ${SAME_NAME_METERS}), false) and (
            ${wordsContained(sql`names.a_words`, sql`names.b_words`)}
            or ${wordsContained(sql`names.b_words`, sql`names.a_words`)}
            or similarity(array_to_string(names.a_words, ' '), array_to_string(names.b_words, ' '))
              >= ${MIN_NAME_SIMILARITY}
          ))
        )
        and ${audience(sql`names.a_words`)} = ${audience(sql`names.b_words`)}
    )
  ))`;
}

// Pairs of a meeting in the `touched` relation (an id column) and another active meeting that could match it:
// the same day and time within 150 m, or sharing an address key or conference key. Each branch can use an
// index, so sidesMatch then runs on a few pairs rather than on every meeting at the same time.
export function matchCandidates(touched: string): SQL {
  const relation = sql.raw(touched);
  return sql`
    select t.id touched_id, other.id other_id from ${relation} touched
    join meetings t on t.id = touched.id
    join meetings other on other.day = t.day and other.time = t.time and other.id <> t.id
      and ST_DWithin(other.location, t.location, ${SAME_NAME_METERS})
    union
    select mine.meeting_id, theirs.meeting_id from ${relation} touched
    join feed_meetings mine on mine.meeting_id = touched.id
    join feed_meetings theirs on theirs.address_key = mine.address_key and theirs.meeting_id <> mine.meeting_id
    union
    select mine.meeting_id, theirs.meeting_id from ${relation} touched
    join feed_meetings mine on mine.meeting_id = touched.id
    join feed_meetings theirs on theirs.conference_key = mine.conference_key
      and theirs.meeting_id <> mine.meeting_id`;
}
