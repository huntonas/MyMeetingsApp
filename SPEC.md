# mymeetingapp — Build Spec (v2)

App name: **mymeetingapp**. Domain: **mymeetingapp.com** (already owned). Both live in one config value (`packages/shared/src/brand.ts`).
Publisher: Gooder Software LLC (Tennessee).

Revised 2026-09-26 after spec review. See [Changes from v1](#changes-from-v1) at the end.

## 1. What we're building

A free iOS and Android app for finding AA meetings and seeing how attendees describe them, using neutral keywords from a fixed list. No free-text reviews, no ratings, no accounts.

Three deliverables in one monorepo (pnpm workspaces + Turborepo):

1. **Mobile app:** React Native + Expo (TypeScript, current SDK, dev builds — native modules rule out Expo Go), one codebase for iOS and Android, built with EAS.
2. **Web + API:** Next.js 16 (App Router, TypeScript). Serves the public website, a password-protected `/metrics` dashboard with admin views, and the versioned mobile API.
3. **Database:** Neon (serverless Postgres) with PostGIS.

Hosting: **Vercel Pro** for the Next.js app, **Neon** for the database.

```
/apps/mobile          Expo app
/apps/web             Next.js site + API
/packages/shared      shared types, brand config, API contracts (zod schemas), error codes
/tools/feed-discovery standalone discovery script (section 4)
```

## 2. Privacy rules

These override convenience everywhere. Flag any conflict instead of working around it.

- **No accounts.** No name, email, phone, or login anywhere.
- **The server knows meetings, not people.** Nothing stored links a device to the meetings it tagged, apart from a 7-day abuse-review log (section 6): tag rows carry only a per-meeting submitter ID, so a copy of the database alone can't join one device's tags across meetings. The server works out one device's rows (from its hash and the pepper) only for delete-mine and for blocking a device, and never stores or returns that list.
- **Personal data never reaches our server:** sobriety date, favorites, the local record of tagged meetings, liked flags, notes, meeting log, journal, call list, recent searches, and the search box text (the phone sends that text to its platform geocoder, Apple or Google, to find a place).
- **Device IDs are stored only as a keyed hash:** `device_hash = HMAC-SHA256(k_device, platform + ":" + rawId)`. The raw ID is never stored or logged. Keys are derived from `DEVICE_ID_PEPPER` via HKDF. The pepper can't be rotated without breaking every existing link, so treat it as permanent.
- **Tag rows use a per-meeting submitter ID:** `submitter_id = HMAC-SHA256(k_submitter, device_hash + ":" + meetingId)`. The same device always gets the same ID for the same meeting, so it can edit or delete its tags at any time, but rows can't be joined across meetings.
- **Location for search:** the phone rounds coordinates to 2 decimal places (about 1 km) before sending them, only in the body of the search request. The server uses them for that query only. Never stored, logged, placed in URLs, or used as cache keys beyond the rounded value.
- **Location for tagging:** the proximity check runs on the phone. Only a boolean (`nearMeeting`) is sent.
- **Location permission:** While Using only, requested the first time the user taps "Use my location" or runs the proximity check. Never at launch. Never in the background.
- **No ads, no analytics SDKs, no tracking,** and no cookies or analytics on the website (no Vercel Web Analytics or Speed Insights).
- **Metrics show totals only,** never per-device rows.
- **Don't log** IP addresses beyond the platform's short-term request logs, and never log request headers or bodies. Error handlers must strip headers before logging.
- **Third parties that receive data** must each be listed in the privacy policy: Vercel (hosting, request logs), Neon (database), Apple and Google (maps, platform geocoder, app attestation), and the AI provider used for suggestion screening (zero data retention).

## 3. Meeting data

Source: the open Meeting Guide JSON spec (`github.com/code4recovery/spec`), published per intergroup (often via the WordPress 12 Step Meeting List plugin). There is no national feed.

- **Launch coverage is nationwide (US).** The feed registry is built by the discovery task in section 4.
- `feeds` table: one row per feed, with a `priority` (lower number wins). Intergroup and district feeds rank above area feeds, since areas often re-publish intergroup data.
- **Sync:** Vercel Cron hits `/api/cron/sync-feeds` every 15 minutes (Vercel sends `Authorization: Bearer $CRON_SECRET`). Each run syncs the stalest feeds whose last successful sync is over 7 days old (a feed whose last attempt failed is retried after a day), and stops starting new feeds after ~240 s so it finishes within the function time limit. Idempotent. One failing feed never affects others.
- **Politeness:** at most 1 request per second per host, conditional requests (`If-None-Match` / `If-Modified-Since`), a per-request timeout, no retry storms.
- **Two layers of meeting data:**
  - `feed_meetings`: raw rows per source, upserted by `(feed_id, source_slug, day)`. A meeting listed on several days becomes one row per day.
  - `meetings`: canonical real-world meetings (stable UUID). Tags, opt-outs, and the API all use the canonical ID.
- **Matching at sync time** (not read time): a new feed row joins an existing canonical meeting when it has the same day and start time and any of: the same normalized address; coordinates within 50 m; the same conference key when both are online or hybrid; or coordinates within 150 m and names that clearly match. Otherwise a new canonical meeting is created. This also handles a slug changing when an intergroup renames a meeting. The canonical meeting takes its display fields from its highest-priority active source.
  - The **conference key** is how conference URLs compare. A Zoom link (any `*.zoom.us` host) that names a meeting becomes `zoom:<id>`, ignoring the regional host, case, query, fragment and stray spaces: `/j/<id>`, `/my/<name>`, `/w/<id>`, `/s/<id>`, `/j<digits>`, `/wc/<digits>/…` or `/wc/join/<digits>`, `/meeting/<digits>`, `/<9–11 digits>`, or a `confno=<digits>` query; `/meeting/register/<token>` becomes `zoom:register:<token>`. Any other URL keeps its query (a Webex `MTID` names the meeting) and only loses surrounding whitespace, its fragment and a trailing slash, with the scheme and host lowercased. Placeholders that name no meeting get no key, since unrelated meetings share them: any other Zoom link (`zoom.us/join`, `/j/` without an id, a bare host) and any other URL with no path beyond `/` and no query (`meet.google.com/`). The raw URL is still what's displayed.
  - A shared conference key doesn't count when both sides have a location more than 150 m apart: hybrid meetings at two venues can share one Zoom link, and merging them would hide a venue. It counts when either side has no location (online only).
  - **Names clearly match** when, after folding accents, lowercasing, dropping the words "group", "grupo", "the", "aa" and "meeting" and splitting on anything that isn't an ASCII letter or digit, every word of one name is a word of the other (those words totalling at least 4 letters) or their trigram similarity is at least 0.5.
  - **Gender** vetoes a match: each listing's genders are the ones its normalized name words and its Meeting Guide type codes name, from this vocabulary (a listing may name both, or neither), and a meeting's genders are the ones its listings name. When both sides name genders and they differ, they never join by address or distance, so a men's and a women's meeting at one place and time stay apart. A side that names none can join either. A stored meeting whose own listings name different genders (merged by an older rule) never matches anything, so it takes no more listings and merges no further. Only a shared conference key overrides the veto, since one Zoom meeting can't host two meetings at once. Other audiences (young people, LGBTQ, seniors, Spanish) don't veto: feeds tag them too inconsistently.

    | Gender | Name words                                                                       | Type code |
    | ------ | -------------------------------------------------------------------------------- | --------- |
    | men    | men, mens, man, guys, brothers, gentlemen, hombres, caballeros, varones, male    | M         |
    | women  | women, womens, woman, ladies, lady, sisters, girls, gals, damas, mujeres, female | W         |

  - Two listings that one feed publishes under different slugs at the same day and time stay separate meetings (two rooms at one address), unless they share a conference key. A new row checks the listings the feed publishes now, so a renamed slug keeps its meeting; merging checks every listing the feed has ever published, so a room it drops from one snapshot can't merge into the other.
  - **Splitting:** after each feed sync, every active listing on a meeting it touched that matches no other listing on that meeting by the same rules (compared listing to listing), other than the meeting's primary listing, moves to a new meeting of its own. This repairs meetings older, looser rules built (a men's and a women's listing, unrelated listings sharing a placeholder URL). Comparing with every other listing rather than only the primary keeps a chain whole where A matches B and B matches C but A and C don't match directly.
  - **Merging:** then the meetings the sync touched, and any split off, are checked against other active meetings by the same rules, and duplicates merge into the oldest meeting (its sources move over and the others are deleted). Duplicates created before a rule existed merge as their feeds next sync. Phase 3 must carry tags across a merge and a split.
- **Field allowlist:** store only name, day, time, end time, time zone, types, location name, address, coordinates, location notes, meeting notes, group name, conference URL/phone/notes, attendance option, and the source page URL. **Do not store** `contact_*` fields, `email`, `phone`, Venmo/Square/PayPal handles, or any other personal contact data.
- **Time zone:** from the feed if present, otherwise derived from coordinates (offline tz lookup library).
- **Geocoding** of meetings missing coordinates runs after sync, using the US Census Geocoder (free, results may be stored).
- Keep the spec's official `types` codes (open/closed, Newcomer, Spanish, wheelchair, etc.) as filters, separate from attendee tags.
- **Removed meetings:** feed rows are archived, not deleted. A canonical meeting is archived when all its sources are archived. Tag history survives feed hiccups.
- **Opt-outs:** `feeds.opted_out` (entity asks us to stop using their feed) and `meetings.tags_disabled` (a group asks not to be tagged: no tags accepted or shown). Requests come in via the support page.
- Record per-feed sync status: last attempt, last success, error, meeting count.

## 4. Feed discovery task (run before launch, then only when needed)

Goal: a verified registry of every US A.A. service entity with a usable meeting feed, plus a coverage report showing gaps. A standalone script in `/tools/feed-discovery`, separate from the app. It runs on demand (locally, or as a manually triggered GitHub Actions workflow that opens a PR with registry changes); the committed registry is the lasting record, so there is no routine re-crawl. Broken feeds show up in the weekly sync instead.

**Source list:** the entities listed in the "A.A. Near You" directory on aa.org (US areas, districts, intergroups, and central offices with websites). Check aa.org's terms and robots.txt first.

**For each entity website, detect the feed type in this order** (verify current TSML endpoint paths against the plugin source before relying on them):

1. TSML WordPress plugin REST feed
2. TSML legacy AJAX feed: `<site>/wp-admin/admin-ajax.php?action=meetings`
3. A Meeting Guide JSON link found on the site's meetings page
4. A public Google Sheet in Meeting Guide format
5. BMLT (Basic Meeting List Toolbox) API
6. None found

**Verification:** a feed counts as `verified` only after fetching it and confirming it returns a JSON array of meetings with at least `slug`, `name`, `day`, and `time`. Record the meeting count and which states the meetings fall in.

**Restricted feeds:** some intergroups deliberately restrict their feeds (an explicit restricted response, a key requirement, or an auth requirement). Record these as `restricted`, never attempt to bypass them, and list them in the report as "contact the intergroup."

**Politeness:** respect robots.txt, at most one request per second per host, a descriptive User-Agent with the contact email admin@goodersoftwarellc.com, and a timeout per request. Never hammer a site with retries.

**Output:**

- `tools/feed-discovery/registry.yaml`, one entry per entity:

```yaml
- id: some-county-intergroup
  name: "Some County Intergroup"
  entity_type: intergroup # area | district | intergroup | central_office
  state: TN
  website: "https://example.org"
  feed_type: tsml # tsml | meeting_guide_json | google_sheet | bmlt | none_found | restricted
  feed_url: "https://example.org/wp-admin/admin-ajax.php?action=meetings"
  verified: true
  meeting_count: 612
  states_covered: [TN]
  cities_covered: ["Knoxville, TN", "Maryville, TN"] # every US city the feed lists a meeting in
  checked_at: 2026-09-25
  notes: ""
```

- `tools/feed-discovery/coverage.md`: per-state summary (entities found, verified feeds, total meetings, restricted feeds, entities with no feed), a table of every verified feed (site, feed type, meetings, states, number of cities, which entities list it), and a list of overlapping feeds. A feed_url shared by several entities counts once.
- Both files are committed, so they are the lasting record of which sites publish a feed, which restrict theirs and what each covers; discovery is re-run only when that record needs refreshing, not routinely.
- A seed script that loads verified feeds into the `feeds` table with priorities (intergroup/district before area).

**Parsers:** one normalizer per feed type, not per site, in `apps/web` (shared with sync). TSML and Meeting Guide JSON share a parser. BMLT gets its own mapping to the Meeting Guide shape. `none_found` entries are a manual backlog, not scraped.

**Re-verification:** flag feeds that stop responding, new entities in the directory, and meeting-count drops over 30%.

**Good-citizen rules (instead of seeking permission):** feeds are public data owned by each entity, so no one is contacted for permission. We honor every restriction an entity sets, identify ourselves honestly in the User-Agent, respect robots.txt, sync each feed no more than once a week, and honor any opt-out an entity or group requests promptly. Only Google Sheet feeds pass through a third party's server (`sheets.code4recovery.org`). If Sheet feeds turn out to matter for coverage, read public Sheets directly through Google's Sheets API instead of relying on that service.

## 5. Tagging system

**Fixed vocabulary, grouped by category.** Stored in the database so it can grow. Tags can be retired (hidden, counts kept) but never hard-deleted.

| Category  | Starter tags                                                                           |
| --------- | -------------------------------------------------------------------------------------- |
| Format    | By the book, Laid back, Speaker-heavy, Lots of sharing, Step study, Literature focused |
| Sharing   | Crosstalk, No crosstalk, Round robin, Raise your hand                                  |
| Crowd     | Newcomer heavy, Old-timers, Young crowd, Older crowd, Mixed ages                       |
| Feel      | Welcoming, Quiet, Lively, Lots of humor, Serious tone                                  |
| Practical | Starts on time, Runs long, Coffee, Fellowship after, Easy parking, Accessible entrance |

**Data model:** one row per device per meeting in `tag_submissions`:
`(meeting_id, submitter_id, tag_ids[], near_meeting, confirmed_at, updated_at, excluded)`, primary key `(meeting_id, submitter_id)`.

- `confirmed_at` is set by a new submission and moves forward only when the device tags again at a later meeting.
- Edits change `tag_ids` and `updated_at` only.

**Submission rules (enforced server-side):**

- 1 to 6 tags per submission, all from the active vocabulary.
- **New submissions and re-confirmations** are allowed only inside the tagging window: from meeting start until 36 hours later, computed in the meeting's own time zone (DST-aware) for the most recent occurrence. Meetings without a day/time (e.g. "by appointment") can't be tagged. Online and hybrid meetings can be tagged. `nearMeeting` is always false for online attendance.
- **One confirmation per meeting per device per 7 days.** A second new submission within 7 days returns `already_tagged` (the app should offer to edit instead).
- **Edits are allowed at any time**, even after the window closes. They keep the original `confirmed_at` and `near_meeting`, and don't count toward the daily cap.
- **Deletes are allowed at any time.**
- **Daily cap:** 10 new submissions per device per UTC day (edits and deletes excluded).
- Rate limits live in Postgres (`rate_limits(device_hash, bucket, window_start, count)`, with no meeting ID), not memory.

**Display rule:**

- Tags appear as a **flat list with counts** (e.g. "Laid back 14"). No paired-opposite spectrums.
- The count for a tag is the number of non-excluded submissions for that meeting whose current tag set includes it and whose `confirmed_at` is within the last 180 days. Each device counts at most once per tag per meeting.
- Sorted by count, highest first. Ties broken by the number of those submissions with `near_meeting = true`.
- Counts are kept in a `tag_counts(meeting_id, tag_id, device_count, verified_count)` table, updated in the same transaction as each write. A nightly job recomputes it to expire entries older than 180 days and to apply exclusions.
- Every tag used on a meeting shows immediately. `POST`/`PUT`/`DELETE` tag responses return the meeting's updated counts so the app can show them without waiting on any cache.
- Blocked devices' submissions are excluded, and counts update when a device is blocked or deletes its tags.

**Suggestions:**

- Users can suggest a new word (2–40 characters, 5 per device per day).
- AI screening through Vercel AI Gateway with zero data retention (model set by env var): auto-merge clear synonyms of existing tags, auto-reject names, judgments, or anything identifying, and leave the rest pending. Log every AI decision (input, decision, reason, model, timestamp).
- The admin reviews pending suggestions in a weekly batch (approve, merge, reject) in an admin view behind the `/metrics` auth.
- Suggestions store `device_hash` only until reviewed or for 30 days, whichever comes first, then the link is removed.

## 6. Anti-spam without accounts

- **Device ID:** iOS generates a random UUID stored in the Keychain with a `ThisDeviceOnly` accessibility class (survives reinstall, not synced to iCloud). Android uses `ANDROID_ID`.
- **`devices` table:** `device_hash`, `platform`, `first_seen_date`, `last_seen_date` (date only), `blocked`, attestation key data. No meeting references.
- **App integrity:** iOS App Attest (+ DeviceCheck bits for flagging abusive devices across reinstalls); Android Play Integrity API (standard requests with a request hash). Look for a maintained Expo module first; write a small native module per platform only if needed. Server verification sits behind `REQUIRE_ATTESTATION` so development works without it.
  - Registration: `POST /api/v1/attest/challenge` issues a single-use challenge (stored 5 minutes); `POST /api/v1/attest/register` verifies the iOS attestation and stores the key ID, public key, and counter under `device_hash`.
  - Each write: iOS sends an App Attest assertion over the SHA-256 of the request body plus timestamp; the server checks the signature and that the counter increased. Android sends a Play Integrity token whose request hash matches the body.
- **Abuse-review log:** `tag_audit(device_hash, meeting_id, action, at)`, purged after 7 days. This is the only place a device is linked to meetings, and it exists so the admin can identify and block devices behind a flagged swing.
- **Pattern check (flag for review, never auto-block):** sudden one-sided tag swings on a meeting (e.g. one tag gaining 5+ new devices within 48 hours on a meeting that had fewer than 10 in total). No cross-meeting or device-cluster analysis.
- **Blocking:** the admin marks a device `blocked`. Its future writes are rejected with `device_blocked`, and the server sets `excluded = true` on its past rows by computing its `submitter_id` for every meeting (about 60k HMACs, which is fast), then recomputes counts for affected meetings. A blocked device's row is exempt from the 13-month inactivity purge: blocking is a standing decision, not undone by inactivity or by delete-mine.

## 7. API (`/api/v1`)

Versioned from day one; old app versions stay installed for months. All input is validated with zod schemas shared with the mobile app.

Mobile headers on write requests: `X-Device-Id`, `X-Platform` (`ios` | `android`), `X-App-Version`, `X-Attestation`.

| Method | Path                       | Purpose                                                                                                                                                                                                                                                              |
| ------ | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/config`           | Minimum supported app version per platform, latest version, feature switches (tagging, suggestions). Cacheable (5 min).                                                                                                                                              |
| GET    | `/api/v1/vocabulary`       | Active tags (slug, label, category). Cacheable.                                                                                                                                                                                                                      |
| POST   | `/api/v1/meetings/search`  | Body: `{ lat, lng, radiusKm }` with lat/lng rounded to 2 decimals (validated). Returns in-person and hybrid meetings within the radius (max 1000), with distance from the rounded point, types, and tag counts. Filtering by day/time/type/tag happens on the phone. |
| GET    | `/api/v1/meetings/online`  | All online meetings nationwide, deduplicated by conference key, with tag counts. Cacheable (15 min).                                                                                                                                                                 |
| GET    | `/api/v1/meetings/:id`     | One meeting with tag counts (for favorites and detail refresh). Cacheable (5 min).                                                                                                                                                                                   |
| POST   | `/api/v1/tags`             | New submission: `{ meetingId, tags: string[], nearMeeting?: boolean }`. Returns updated counts.                                                                                                                                                                      |
| PUT    | `/api/v1/tags/:meetingId`  | Edit this device's tags on a meeting, any time: `{ tags: string[] }`. Returns updated counts.                                                                                                                                                                        |
| DELETE | `/api/v1/tags/:meetingId`  | Delete this device's tags on a meeting. Returns updated counts.                                                                                                                                                                                                      |
| POST   | `/api/v1/tags/delete-mine` | Delete all tags, suggestions still linked to this device (with their AI decisions), rate-limit rows, audit rows and attestation data for this device (server computes `submitter_id` for every meeting).                                                             |
| POST   | `/api/v1/suggestions`      | `{ text }`                                                                                                                                                                                                                                                           |
| POST   | `/api/v1/attest/challenge` | Single-use attestation challenge.                                                                                                                                                                                                                                    |
| POST   | `/api/v1/attest/register`  | Register an App Attest key (iOS).                                                                                                                                                                                                                                    |
| GET    | `/api/cron/sync-feeds`     | Batch feed sync, `CRON_SECRET` protected. Every 15 minutes.                                                                                                                                                                                                          |
| GET    | `/api/cron/maintenance`    | Nightly: recompute tag counts, purge 7-day audit log, expired challenges, old rate-limit rows, and suggestion device links. `CRON_SECRET` protected.                                                                                                                 |

**Search caching:** the meeting list for a `(lat, lng, radiusKm)` key may be cached server-side (Runtime Cache, 15 min, invalidated on sync). Tag counts are always joined fresh from `tag_counts`. Coordinates are never in URLs, so they never appear in request logs or CDN cache keys.

**Errors** return `{ error: { code, message } }` with plain-language messages the app can show directly:
`invalid_request`, `meeting_not_found`, `window_closed`, `already_tagged`, `not_tagged`, `too_many_tags`, `unknown_tag`, `tags_disabled`, `rate_limited`, `attestation_failed`, `device_blocked`, `upgrade_required`.

## 8. Mobile app

On-device storage: `expo-sqlite` for personal data and cached results; `expo-secure-store` (Keychain) for the iOS device ID.

**Version 1 (MVP):**

- **Meeting search:** list and map views (react-native-maps: Apple Maps on iOS, Google Maps on Android). Filter by day, time, official types, and tags on the phone. The server returns meetings sorted by distance from the rounded point; the phone re-sorts by exact distance using the real location, which never leaves the phone. Directions hand off to Apple Maps or Google Maps.
- **Without location:** a fresh install with no location permission shows a search box and an "Use my location" button. Nothing is requested at launch.
- **Searching another area** (traveling, planning ahead, or not sharing location):
  - The search box accepts a city, zip, or address, resolved with the platform geocoder (iOS `CLGeocoder`, Android `Geocoder`). Our server never receives the query text, only the rounded result point.
  - Meetings are sorted by distance from the searched point.
  - Panning the map searches around the new map center (radius from the visible area).
  - Recent searched places are saved on the phone.
  - If no in-person meetings are found, say so plainly and show the online meetings view rather than an empty screen.
- **Online now:** meetings in progress from `/meetings/online`, in the user's local time.
- **Meeting detail:** time, place, types, all tags with counts, "Tag this meeting" (enabled only in the tagging window for new submissions), and "Edit my tags" / "Remove my tags" whenever this device has tagged it.
- **Attendance check:** while the app is open and location permission is already granted, opening a meeting's detail during its time (15 min before start to 30 min after end, or 90 min after start if no end time) checks proximity on the phone: within 200 m, plus the location's accuracy, capped at 500 m. The result is stored locally and sent later as `nearMeeting`. The tag flow offers the same check with the explanation: "We check you're near the meeting to stop spam. Your location never leaves your phone." On iOS, if only approximate location is on, request temporary full accuracy (needs `NSLocationTemporaryUsageDescriptionDictionary`). On Android, request precise location for this check.
- **Tagging flow:** choose up to 6 tags grouped by category, shown as a flat list.
- **My tags (local record):** the phone keeps a record of every meeting it tagged, with the tags chosen and dates. Used for the edit/remove buttons and a "Meetings I've tagged" list. Never sent to the server.
- **Favorites:** on the phone.
- **Sobriety counter:** date stored on the phone; total days plus years/months/days; milestones at 24 hours, 30/60/90 days, 6 and 9 months, 1 year, and each year after. Resets use neutral "set a new date" wording, with no streak-broken messaging.
- **Settings:** show the app ID (copyable, for support), delete all my tags, privacy policy and support links, help resources.
- **Always reachable:** 988 and the SAMHSA National Helpline (1-800-662-4357).
- **Offline:** cache the last search results, online meetings, and favorited meetings' details.
- **Forced upgrade:** check `/config` at launch; below the minimum version, show an upgrade screen but keep offline data (favorites, sobriety counter, crisis numbers) usable.

**Later phases (design data models now, build later):** liked flag, private meeting notes, meeting log (e.g. 90 in 90), journaling (original prompts), call list with one-tap calling, local meeting reminders, home-screen widget for the sobriety counter, first-meeting guide, and encrypted backup to the user's own iCloud or Google account.

**Do not bundle AA literature text** (Big Book, _Daily Reflections_); it's copyrighted by AA World Services. Link to official sources.

## 9. Website (Next.js)

Public pages, statically rendered, fast, and accessible:

- **Landing page:** headline, store buttons, an example meeting card showing descriptive tags, explanation of "descriptions, not ratings," privacy summary, help resources.
- **Privacy policy, support page with FAQ, terms of use.**
  - Terms state the app is not affiliated with or endorsed by AA or A.A. World Services, that listings may be out of date, that it isn't medical advice, and Tennessee governing law.
  - The privacy policy matches the data inventory in section 13 exactly, including the third parties in section 2 and that deleted data may persist in database backups for up to the Neon point-in-time-restore window.
  - The support page explains how entities and groups can opt out.
- Footer on every page: non-affiliation statement.
- `robots.txt` (disallow `/metrics`, `/api/`), sitemap, Open Graph tags, `MobileApplication` structured data, iOS Smart App Banner once live.
- **Later SEO:** statically regenerated city pages like "newcomer-friendly meetings in [city]" built from aggregate tags.

Design direction: calm, plain, highly legible (Atkinson Hyperlegible, self-hosted via `next/font`), light and dark mode, left-aligned single column, no stock-template look.

## 10. Metrics and admin (`/metrics`)

- Protected by HTTP Basic Auth in `proxy.ts` (Next.js 16's replacement for middleware), constant-time credential comparison, HTTPS only, `noindex`, `no-store`, rate-limited failed logins.
- Admin actions use Server Actions (Next.js checks the request origin) so Basic Auth can't be abused through CSRF.
- Server components query Postgres directly; no public metrics endpoint.
- **Shows:** active devices (7 and 30 days, from `last_seen_date`), new tag submissions this week, share with the attendance check, meetings with at least one tag vs. total, pending suggestions, submissions per day (14 days), top tags (30 days), platform split, per-feed sync health (flag feeds without a successful sync in 30 hours).
- **Admin views:** suggestion review, AI decision log, flagged tag swings (with the 7-day audit rows needed to block), block device, per-meeting `tags_disabled`, feed `opted_out`.

## 11. Store requirements

- Privacy policy URL (both stores) and support URL (Apple), linked in the app's settings too.
- **Apple App Privacy label:**
  - Coarse Location (app functionality)
  - Device ID (app functionality, fraud prevention)
  - Other User Content (tags, suggestions)
  - All marked not linked to identity and not used for tracking.
- **Google Play Data safety:**
  - Approximate location (processed ephemerally for search)
  - Device or other IDs
  - App activity / other user-generated content
  - Plus whatever Google's own guidance lists for the Maps SDK and Play Integrity.
- iOS location purpose strings (when-in-use, temporary full accuracy), iOS privacy manifest (required-reason APIs), Android coarse + fine foreground location permissions only.
- Age rating questionnaires (alcohol references apply).
- App Store keywords: AA meetings, meeting finder, sobriety counter. "AA" is an AAWS trademark: use it descriptively only, never in the app name or icon.

## 12. Infrastructure (Vercel Pro + Neon)

- **Database access:** Drizzle ORM with `pg` against Neon's pooled connection string (the `-pooler` host), using `attachDatabasePool` from `@vercel/functions`. The direct (unpooled) string is used only for migrations. PostGIS `geography(Point)` with a GiST index for radius search.
- **Setup:** connect Neon through the Vercel integration so `DATABASE_URL` is set per environment.
- **Preview deployments:** all previews share one Neon branch, `preview`, whose parent is a `seed` branch containing feeds, meetings, and vocabulary but no device-derived tables. Each preview build restores `preview` from `seed` through the Neon API before migrating. Never branch previews from production. (The integration can't choose a parent branch, and per-deployment branches broke when migrations were regenerated.)
- **Migrations:** drizzle-kit in CI against the direct connection string, never on app startup.
- **Cold starts:** Neon can scale to zero. Cacheable endpoints use `s-maxage`, and search results use Runtime Cache, which hides most of this.
- **Cron:** defined in `vercel.ts`: `sync-feeds` every 15 minutes, `maintenance` nightly. Cron only runs on production deployments. Routes must be idempotent.
- **Discovery:** on-demand GitHub Actions workflow (section 4).
- **Secrets:** `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `METRICS_USER`, `METRICS_PASSWORD`, `DEVICE_ID_PEPPER`, `CRON_SECRET`, `REQUIRE_ATTESTATION`, `AI_GATEWAY_API_KEY` (or OIDC), `SUGGESTION_MODEL`, Apple App Attest team/bundle IDs, Google Play Integrity credentials. All in Vercel environment variables. Never commit them.

## 13. Data inventory (source of truth for the privacy policy)

| Stored on server    | Contents                                                                   | Linked to                                               | Retention                                                                      |
| ------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `devices`           | device hash, platform, first/last seen date, blocked flag, attestation key | nothing else                                            | until delete-mine; inactive 13 months → deleted (blocked devices kept, see §6) |
| `tag_submissions`   | per-meeting submitter ID, tags, nearMeeting, dates                         | one meeting only                                        | until edited/deleted; counts only use 180 days                                 |
| `tag_counts`        | meeting, tag, device count, near-meeting count                             | one meeting only                                        | rebuilt on every tag write and nightly                                         |
| `tag_audit`         | device hash, meeting, action, time                                         | device + meeting                                        | 7 days                                                                         |
| `tag_swings`        | meeting, tag, new and prior device counts, flagged/reviewed time           | one meeting only                                        | kept                                                                           |
| `meeting_aliases`   | merged-away meeting id, surviving meeting id                               | meetings only                                           | kept                                                                           |
| `rate_limits`       | device hash, bucket, count                                                 | device only                                             | 2 days                                                                         |
| `suggestions`       | text, status, merged tag; device hash until reviewed                       | device (temporary)                                      | text kept; device link ≤ 30 days; deleted by delete-mine while still linked    |
| `ai_decisions`      | suggestion text, AI decision, reason, model, time                          | a suggestion (device link via the suggestion ≤ 30 days) | kept; deleted with its suggestion by delete-mine                               |
| Search request      | rounded lat/lng (~1 km)                                                    | nothing                                                 | not stored; used for one query                                                 |
| Vercel request logs | IP, path, time                                                             | nothing we control                                      | Vercel plan retention                                                          |

| Stays on the phone                                                                                                                                                                        |     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| exact location, search box text, recent searches, favorites, sobriety date, local record of tagged meetings, attendance-check results, cached meetings, all later-phase personal features |     |

## 14. Acceptance criteria for MVP

- [ ] A fresh install can find meetings with no account and no location permission (search box → platform geocoder → rounded point).
- [ ] With location allowed, nearby sorting works. The only coordinates in network traffic are rounded to 2 decimals, only in `POST /meetings/search` bodies. None appear in URLs, logs, or the database (verify with a proxy and a DB scan).
- [ ] Tagging outside the window, a second new submission within 7 days, or unknown tags are rejected with a clear message.
- [ ] Editing and deleting tags works any time after the window closes, and counts update in the response.
- [ ] A new tag appears on a meeting immediately with a count of 1, and the count increases once per distinct device.
- [ ] Tag rows for two meetings tagged by the same device have different submitter IDs; after 7 days, no table links that device to either meeting.
- [ ] `delete-mine` removes every tag, still-linked suggestion (with its AI decisions), rate-limit, audit and attestation row for the device, and counts update.
- [ ] Sobriety date, favorites, the local tag record, and any later personal features never appear in network traffic.
- [ ] `/metrics` returns 401 without credentials, shows totals only, and admin actions reject cross-origin requests.
- [ ] Feed discovery produces a registry and per-state coverage report, with restricted feeds recorded and skipped.
- [ ] Feed sync handles a failing feed without affecting others and reports it on `/metrics`.
- [ ] A feed meeting whose slug changes stays attached to the same canonical meeting and keeps its tags.
- [ ] No personal contact fields from feeds are stored or returned.
- [ ] An app below the minimum version shows the upgrade screen, and offline data still works.
- [ ] Every privacy policy statement maps to a row in section 13 and to behavior in code.

## 15. Decisions log

- Tags: flat list with counts (no spectrums).
- Funding: free, no tip jar for now. Hosting on Vercel Pro anyway, since the publisher is an LLC.
- Search runs on the server with location rounded to ~1 km. Chosen over on-device search for simplicity and small downloads.
- Per-meeting submitter IDs; no device-cluster analysis.
- Tags editable any time; the window limits new submissions only.
- Maps: Apple Maps (iOS) / Google Maps (Android), disclosed.
- Feed sync on Vercel Cron in 15-minute batches.

## 16. Before launch (non-engineering)

- Legal review of whether Washington's My Health My Data Act and the FTC Health Breach Notification Rule apply, and of the privacy policy and terms.
- Confirm use of the "AA" mark in store metadata is descriptive only.

## Changes from v1

- **Search moved to the server.** Replaced on-device search, the region model, bounding boxes, the region browser, and offline region downloads. Location is rounded to ~1 km and sent in POST bodies only.
- **Canonical meetings** with stable IDs, matched at sync time. Replaces read-time dedup, fixes the `(feed_id, slug)` key conflicting with one row per day, and keeps tags when slugs change or feed priority shifts.
- **Per-meeting submitter IDs,** a 7-day audit log in place of long-term device-to-meeting links, and HMAC instead of `sha256(pepper + …)`.
- **Device-cluster check dropped.**
- **Tags editable and deletable at any time** (new `PUT` and `DELETE` endpoints); write responses return fresh counts so they show immediately despite caching.
- **Attendance check can happen during the meeting** and be sent later; proximity radius defined.
- **New endpoints:** `/config` (forced upgrade), `/meetings/online`, `/meetings/:id`, attestation challenge/register, nightly maintenance cron.
- **Stored tag-count table** instead of computing counts on read.
- **Personal contact fields from feeds are not stored.**
- **Per-group tagging opt-out.**
- **Preview databases** branch from a seed branch, never production.
- **CSRF protection and login rate limiting** for admin.
- **Census geocoder;** time zone derived from coordinates when missing.
- **Vercel Pro,** 15-minute sync batches, on-demand discovery in GitHub Actions.
- **Full third-party list and data inventory** for the privacy policy and store forms.
