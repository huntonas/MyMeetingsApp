# NA meetings: design

Owner decisions, 2026-10-05. The app becomes a meeting finder across fellowships, with sobriety tools alongside (the meeting check-in for 90 in 90 and the rest are a later, separate design). NA comes first; Al-Anon, ACA and others later reuse what this builds.

## Decisions

| Question                    | Decision                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| What the app is first       | A meeting finder across fellowships, with sobriety tools alongside                                            |
| What to build first         | NA meetings, then the tools                                                                                   |
| How fellowships appear      | Every fellowship's meetings together, each labeled, with a Fellowship filter that runs on the phone           |
| Where NA meetings come from | Each NA region's own BMLT server, one feed each, found through the aggregator's server list                   |
| Consent                     | As with AA today: public servers, no outreach, every opt-out honored promptly                                 |
| Remembering the filter      | Not at first: filters stay in memory only (spec §8). Remembering it on the phone can come later if people ask |

## 1. Data and sync

### Fellowship

- `feeds.fellowship`: `aa` or `na`, from a `FELLOWSHIPS` list in `packages/shared` that later fellowships extend. Existing feeds become `aa` in the migration.
- `registry.yaml` entries gain `fellowship` (default `aa` when absent, so today's entries parse unchanged).
- A meeting's fellowship is its feed's. Matching (`sidesMatch` in `server/meetings/match.ts`) only merges listings from feeds of the same fellowship, so an AA and an NA meeting at one church at the same time stay two meetings. Merging of stored meetings follows the same rule.
- The meeting contract in `packages/shared` gains `fellowship`.

### The BMLT feed type

- Each NA region's root server (for example `https://natennessee.org/main_server/`) is one feed of type `bmlt`. Its URL is the server's `client_interface/json/?switcher=GetSearchResults` with the data fields the app needs, so the sync reads it with `politeFetch` like any other feed: weekly, throttled per host, the shrink guard, opt-outs and waiting all unchanged.
- Only the server's own meetings are applied: rows whose `root_server_uri` isn't this server (an aggregator answering) are skipped.
- `normalizeBmlt` in `server/feeds/` maps a BMLT row to `FeedMeeting`:
  - `weekday_tinyint` 1–7 (Sunday = 1) to the app's 0–6 (Sunday = 0);
  - `start_time` `HH:MM:SS` to `HH:MM`; `duration_time` to the end time;
  - `venue_type` 1 / 2 / 3 to `in_person` / `online` / `hybrid`;
  - the address from `location_street`, `location_municipality`, `location_province`, `location_postal_code_1`, and the place name from `location_text`;
  - `time_zone`, or, when blank (Nashville's server leaves some blank), the zone from the coordinates as for other feeds;
  - `virtual_meeting_link` and `phone_meeting_number` to the conference fields, through the same allowlist;
  - `id_bigint` to the source slug, so a renamed meeting keeps its id.
- Format codes: a fixed map from BMLT's NA codes (O, C, Spe, St, D, BT, JT, IW, SWG, and the rest of the NAWS list) to meeting types. NA-only formats join `MEETING_TYPE_CODES`: Basic Text, Just for Today, It Works: How and Why, Step Working Guide. Unknown codes are dropped, as unknown Meeting Guide types are today.

### Discovery

- `tools/feed-discovery` reads the aggregator's public list of root servers, keeps the U.S. ones, checks each answers `GetSearchResults` with a meeting array, and records it as `feed_type: bmlt`, `fellowship: na`, with its meeting count and states covered.
- The coverage report counts meetings per fellowship.
- Seeding works as today.

### Privacy

Nothing new reaches the server about people. A search sends the same rounded point and the server returns every fellowship's meetings; the phone does the filtering, so the server never learns which fellowship someone attends. `fellowship` describes meetings, so the data inventory (spec §13) doesn't change; the privacy policy's column pin lists the new columns.

## 2. The app

- **Labels:** every meeting row, map marker callout and meeting page shows the fellowship ("AA", "NA") beside its types. This is the one place the app names AA or NA: it says which meeting this is.
- **Fellowship filter:** a fifth filter group beside Day, Time, Type and Tags, with one checkbox pill per fellowship in the answer. It starts with none chosen (every meeting shown), is independent of the other groups, is held in memory only, and Clear filters clears it. It filters the search's answer on the phone.
- **Types:** the Type filter offers only types some meeting in the answer has, so NA's formats appear only where NA meetings do.
- **Tags:** one vocabulary for every fellowship; tags describe meetings, not fellowships. Tagging, the 36-hour window, the attendance check and group opt-outs work the same.
- **Help:** beside "Alcoholics Anonymous has its own meeting finder at aa.org", the Help sheet (app and website) adds "Narcotics Anonymous has its own meeting finder at na.org". The URL is a shared constant like `AA_MEETING_FINDER`.

## 3. Wording, legal and rollout

### Wording and legal

- Store listings and the website say "recovery meetings", and "AA and NA meetings" only where they list what's included. The copy tests extend to NA's name: AA and NA are named only there, in the disclaimers and in the pointers to their own finders.
- Disclaimers: "not affiliated with or endorsed by Alcoholics Anonymous, A.A. World Services, Inc., Narcotics Anonymous or NA World Services, Inc.", in the store listings, terms and footer.
- Privacy policy, Meeting listings: sources are "intergroups, NA regions and other service entities".
- Support page: how an NA region opts out (the same path as an intergroup).
- App Review notes mention NA meetings and their source.

### Rollout

The 1.0 app parses meeting types against a fixed enum, so a response containing an NA type would make its whole search fail.

1. Server: the fellowship columns, the BMLT parser, matching by fellowship, discovery and seeding. The search, meeting and tag endpoints send NA meetings and NA type codes only to apps whose `X-App-Version` is 1.1.0 or later; 1.0 gets exactly what it gets today.
2. App 1.1: labels, the Fellowship filter, NA format names, the Help line.
3. Store copy and screenshots with 1.1.

`/metrics` shows feed and meeting counts by fellowship.

### SPEC.md

§1 (what we're building), §3 (fellowship on meetings; matching within one fellowship), §4 (BMLT discovery and parser), §8 (the Fellowship filter, labels, Help line), §9 and §11 (copy and disclaimers), §15 (decisions log).

## Testing

Test first, as always.

- **Parser:** a saved real sample from `natennessee.org`: the day offset, `HH:MM:SS`, durations, blank time zones, the three venue types, split addresses, format codes (known, NA-only and unknown), conference links, and rows from another root server skipped.
- **Matching:** an AA and an NA meeting at the same place, day and time stay two meetings; two NA listings of one meeting still merge.
- **Sync:** a BMLT feed served by `@mymeetingapp/test-server` syncs, honors opt-outs and waiting, and applies the shrink guard.
- **Discovery:** reads a served root-server list, keeps U.S. servers, records `bmlt` / `na`.
- **API:** 1.0 never receives an NA meeting or type code; 1.1 does.
- **App:** the Fellowship filter (with the others, with Clear filters, never saved), labels on rows, the map and the meeting page, NA format names, the Help line.
- **Copy:** the store and website tests cover NA's name and the new disclaimer.

## Out of scope

- Al-Anon, ACA and other fellowships (they reuse `fellowship` and the filter; each needs its own source and terms check).
- The meeting check-in for 90 in 90, and the other sobriety tools: a separate design.
- Remembering the Fellowship filter.
- Countries other than the U.S.
