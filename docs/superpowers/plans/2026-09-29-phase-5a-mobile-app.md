# Phase 5a: Mobile App (Find Meetings) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Expo dev build of mymeetingapp for iPhone (and the iOS simulator) that finds AA meetings with no account and no location permission. It covers:

- search by place, by location or by panning the map, with filters;
- online meetings happening now, meeting details and directions;
- saved meetings and a sobriety counter;
- the 988 and SAMHSA numbers on every screen;
- offline use with clearly labelled saved copies, and a forced-upgrade screen.

A proxy audit proves that only rounded coordinates, and no personal data, reach our server.

**Architecture:**

- **Workspace.** `apps/mobile` is a new pnpm workspace: Expo SDK 57 with Expo Router (file routes under `src/app`) and TypeScript strict. It reads every server response through the zod contracts in `packages/shared`.
- **Storage.** Everything the phone keeps (cached responses, recent places, favorites, the sobriety date) lives in one `expo-sqlite` database, behind `appDatabase()` and an append-only migration list.
- **Reads.** Every read goes through `cachedRead`. It reuses a saved copy only for as long as the website's published catch-up promises allow (`REUSE_MINUTES`, derived from the same shared constants that set the API's Cache-Control headers). When the server can't be reached it shows the saved copy with a "saved copy" note.
- **Place search.** A small local Expo module (`modules/native-location`) calls the platform geocoder (Apple's `CLGeocoder`, Android's `Geocoder`) without needing location permission. The search text never reaches our server.
- **Tests.** jest-expo with React Native Testing Library and `expo-router/testing-library`:
  - screens render through the real `src/app` directory;
  - native modules are faked only at their package boundary (`test/native/*`), with a real SQLite engine (sql.js) behind `expo-sqlite`;
  - the API is a real local HTTP server (`@mymeetingapp/test-server`).
- **Network audit.** A new `tools/network-audit` package checks a mitmproxy HAR capture against the privacy rules.

**Tech Stack:** Expo SDK 57 (`expo` 57.0.26, React Native 0.86.3, React 19.2.3), Expo Router 57 (`expo-router/js-tabs`, `Stack`), `expo-sqlite` 57, `expo-location` 57, `expo-application` 57, `expo-font` 57 (config plugin, fonts embedded at build), `@expo-google-fonts/atkinson-hyperlegible` 0.4.1, `react-native-maps` 1.27.2 (Apple Maps on iOS, Google Maps on Android), `@react-native-community/datetimepicker` 9.1.0, `@expo/vector-icons` 15. Tests use jest 29.7 with `jest-expo` 57, `@testing-library/react-native` 14 and `sql.js` 1.14. zod 4 and the shared package. The audit uses mitmproxy (HAR export), with a TypeScript tool on vitest 5.

Versions were checked with `npm view` on 2026-09-29. `expo` `latest` is 57.0.26 (`next` is 58.0.0, a pre-release, not used), and SDK 57's `bundledNativeModules.json` pins the native versions above. Always add native packages with `pnpm --filter mobile exec expo install <name>`, so the SDK chooses the version.

**Spec:** `SPEC.md` (v2): §2, §7, §8, §11 (purpose strings and permissions), §13 ("Stays on the phone"), §14 (Phase 5 rows). Roadmap: `docs/superpowers/plans/2026-09-26-roadmap.md` (Phase 5). Standards: `docs/standards.md` (binding). Website promises the app must keep, from branch `phase-4-website` (PR #14):

- `apps/web/src/app/(site)/privacy/page.tsx`;
- `apps/web/src/app/(site)/support/page.tsx`;
- `apps/web/src/content/privacy-inventory.ts`;
- `apps/web/src/lib/catch-up.ts`;
- `docs/deploy.md`.

**Depends on:** Phases 1, 2, 3 and 7 merged, and **Phase 4 (PR #14) merged** (see Owner decision 2). Task 1 moves Phase 4's cache lifetimes and catch-up constants into `packages/shared`. The app consumes:

- `packages/shared`: `AppConfigResponse`, `VocabularyResponse`, `STARTER_VOCABULARY`, `TAG_CATEGORIES`, `MeetingSummary`, `MeetingSearchRequest`, `MeetingSearchResponse`, `OnlineMeetingsResponse`, `MeetingDetailResponse`, `MEETING_TYPE_CODES`, `ApiErrorBody`, `ErrorCode`, `SemVer`, `BRAND`;
- the routes `GET /api/v1/config`, `GET /api/v1/vocabulary`, `POST /api/v1/meetings/search`, `GET /api/v1/meetings/online?day=0..6` and `GET /api/v1/meetings/:id` (a merged-away id answers 200 with the surviving meeting under its own id).

## Scope: Phase 5a and Phase 5b

Phase 5 is too big for one plan (it would be about 24 tasks). It is split where the app starts writing to the server.

**Phase 5a (this plan), the read-only app:**

- workspace and tooling;
- the API client for reads;
- the offline cache with the catch-up rules;
- forced upgrade and Help now;
- the Online tab;
- location and place search;
- the Nearby list with filters;
- the map;
- meeting details;
- favorites and the Saved tab;
- the Me tab with the sobriety counter;
- the network-audit tool;
- the iPhone dev build, accessibility pass, audit and smoke test.

5a sends no device ID and no write request.

**Phase 5b (next plan, written when 5a lands), the writing app:**

- The device ID: a random UUID in the iOS Keychain (`expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`); on Android, `ANDROID_ID` from `expo-application`.
- The write client:
  - move `WriteHeaders` (and its header names) from `apps/web/src/server/devices/write-request.ts` into `packages/shared`;
  - send `X-Device-Id`, `X-Platform` and `X-App-Version` on writes only;
  - leave `X-Attestation` out while `REQUIRE_ATTESTATION=off`, with an `attestationFor(body)` seam that returns `undefined` until Phase 6.
- The attendance check (spec §8 thresholds: 15 min before start to 30 min after end, or 90 min after start; within 200 m plus accuracy, capped at 500 m). It adds `requestTemporaryFullAccuracy` to `modules/native-location` (iOS `NSLocationTemporaryUsageDescriptionDictionary`) and asks for precise location on Android.
- The tagging flow (up to 6 tags, grouped by category), which handles `already_tagged` (offer to edit), `window_closed`, `tags_disabled`, `rate_limited`, `upgrade_required` and the `features.tagging` switch.
- The local my-tags record:
  - "Edit my tags" / "Remove my tags", and a "Meetings I've tagged" list;
  - `meetingMoved` extended to the record (owner decision 6).
- Settings: "Delete all my tags", which calls `delete-mine` and clears the local record.
- The suggestions UI (`POST /suggestions`, behind `features.suggestions`).
- The Android dev build: Google Maps key, and a debug-only user-CA trust so mitmproxy can see its traffic.
- The audit and smoke test repeated on both platforms, with device headers allowed on write paths only.
- Every Phase 5 row of spec §14 checked end to end.

## Owner decisions needed

Each item has a recommendation, and the plan is written to follow it so work isn't blocked. Say so if you want something different.

1. **Android can't search by place without location permission through `expo-location`.** `expo-location` 57's Android `geocodeAsync` refuses to run until location permission is granted (`LocationModule.kt`: `if (isMissingForegroundPermissions()) throw LocationUnauthorizedException()`), although Android's own `Geocoder` needs no permission. Spec §14 requires a fresh install with no permission to find meetings through the platform geocoder.
   - **Recommendation:** a small local Expo module, `modules/native-location`, with `findPlace(text)` on both platforms: Apple's `CLGeocoder` and Android's `Geocoder`, about 40 lines of Swift and Kotlin.
   - 5b adds `requestTemporaryFullAccuracy` to the same module, which `expo-location` 57 doesn't offer either.
   - Task 7 builds it. Native code can't run in Jest, so it is covered by the device smoke test (Task 14) and faked in unit tests.
2. **Start 5a after PR #14 (Phase 4) merges.** The catch-up promises (75 and 90 minutes; 25 hours for the tag list) and the cache lifetimes behind them exist only on `phase-4-website`.
   - **Recommendation:** merge PR #14, then branch `phase-5a-mobile` from `main`.
   - If 5a must start first, rebase it onto `main` after the merge, before Task 1.
3. **Which server dev builds use.** Previews sit behind Vercel deployment protection, which the app can't pass.
   - **Recommendation:** 5a dev builds read from production, `https://mymeetingapp.vercel.app`, through `EXPO_PUBLIC_SERVER_URL`. 5a only reads public, cacheable data, and its search requests carry only a rounded point, which the server never stores.
   - For local work, point `.env` at the Mac's LAN address (`http://192.168.x.y:3000`).
   - 5b will test writes against local web, never production, so test tags never enter production counts.
4. **Bundle identifier and Android package.** Both are permanent once a build is in a store.
   - **Recommendation:** `com.goodersoftware.mymeetingapp` for both.
5. **Google Maps key for Android.** `react-native-maps` on Android draws Google Maps, which needs a Maps SDK for Android key in a Google Cloud project with billing enabled. Check Google's current pricing; mobile map loads have been free.
   - **Recommendation:** create the key before 5b's Android smoke test, restricted to the Android package and the EAS signing certificate's SHA-1, and store it as the EAS secret `GOOGLE_MAPS_ANDROID_API_KEY`.
   - 5a works without it: the owner tests on iPhone first, and Task 9 wires the variable in.
6. **Phone backups.** The app's database (favorites, sobriety date, recent places, cached meetings) sits in the app's normal storage, so the phone's own iCloud or Google backup includes it, as it does for every app.
   - **Recommendation:** keep that. It is the person's own backup, and the privacy policy's promise ("stay on your phone and never reach our server") stays true. Excluding the file from backups would lose a sobriety date when someone restores a new phone.
   - Spec §8's later "encrypted backup" feature is separate.

## Decisions this plan makes (confirm at review)

1. **The split** is described in "Scope" above. Suggestions go to 5b, because they are a write with device headers, like tags.
2. **Test runner.** `apps/mobile` uses Jest (`jest-expo/ios` preset) with React Native Testing Library 14 and `expo-router/testing-library`, not vitest. React Native code needs the React Native Babel and Jest preset, which vitest can't run. The standards table records the exception.
   - Native modules are faked only at their package boundary, by files in `apps/mobile/test/native/` mapped in `jest.config.js`. This is the mobile form of "fake only the console and the environment".
   - `expo-sqlite` is faked by a real SQLite engine (sql.js), so SQL runs for real.
   - The API is a real HTTP server from `@mymeetingapp/test-server` on port 3197. Jest runs one worker (`maxWorkers: 1`), because the port is fixed and because Expo may inline `EXPO_PUBLIC_*` values when it transforms a file, so the value must exist before any transform. `jest.config.js` sets it.
   - Time is faked only through `setNow()` in `test/clock.ts`, which fakes `Date` alone.
3. **How long the app may reuse a copy (owner decision 5).** The website promises tag changes and opt-outs reach the app within `CATCH_UP_MINUTES.app` (75), a feed opt-out within `CATCH_UP_MINUTES.feedOptOut` (90), and tag-list changes within `VOCABULARY_CATCH_UP_HOURS` (25). The CDN may already have held a response for up to its s-maxage plus stale-while-revalidate. So the app reuses its own copy only for the rest of the promise:

   | Response                        | CDN worst case | App reuse (`REUSE_MINUTES`) |
   | ------------------------------- | -------------- | --------------------------- |
   | search (POST, never CDN-cached) | 0              | 75 min                      |
   | meeting detail                  | 15 min         | 60 min                      |
   | online meetings                 | 75 min         | 0                           |
   | vocabulary                      | 25 h           | 0                           |
   | config                          | —              | 0 (read at every launch)    |

   The numbers come from `CDN_LIFETIMES` in `packages/shared/src/freshness.ts`, which the API's Cache-Control headers also use, so neither side retypes them. A copy that's too old is shown only when the server can't be reached, always with `<SavedCopyNote>`: "Showing the copy saved today at 3:40 PM. We couldn't reach mymeetingapp, so it may be out of date."
   - The vocabulary is read once each time the app comes to the foreground (a reuse of 0 means "not across app sessions"), because every tag chip needs its labels.
   - The Online tab rereads each time the tab gains focus.
   - A feed opt-out is covered too: search results are at most 75 minutes old after a 15-minute sync, which is 90.

4. **What the phone keeps offline** (spec §8: "the last search results, online meetings, and favorited meetings' details"):
   - the latest search only (earlier ones are deleted when a new one is saved);
   - online meetings per weekday;
   - each meeting's details. At launch, `pruneCache()` deletes meeting details older than 30 days unless the meeting is saved, and online lists older than 7 days.
5. **Online tab.** "Happening now" and "Starting in the next 2 hours", in the phone's local time.
   - The tab reads three days (the phone's yesterday, today and tomorrow), because a meeting's own weekday can differ from the phone's by one.
   - A meeting with no end time counts as in progress for 60 minutes. A meeting with no time zone isn't shown there.
6. **Time math.** A meeting's day and time are in its own zone. `Intl.DateTimeFormat` gives the zone offset (Hermes supports `timeZone`).
   - A local time that doesn't exist (spring forward) resolves as Postgres does, one hour later.
   - An ambiguous one (fall back) takes the earlier instant.
   - Clock times are formatted by hand ("7:00 PM"), so output doesn't depend on the device's ICU version. The app is US English.
7. **Search radius.**
   - Search box and location searches use 25 km (shown as 16 miles).
   - A map search uses half the visible map's diagonal, rounded up to whole km and clamped to 1–100 (the API's limits).
   - Panning the map searches again only when the rounded center or the radius changes.
8. **Units:** miles, one decimal below 10 ("0.5 mi", "under 0.1 mi"), whole numbers from 10.
9. **Filters.** They are held in memory and never saved; tag and type filters are local, as §7 says.
   - Day: any of Sunday–Saturday.
   - Time of day, on the meeting's listed time: morning 05:00–11:59, afternoon 12:00–16:59, evening 17:00–20:59, night 21:00–04:59.
   - Meeting type: all chosen, from 14 common codes.
   - Tags: all chosen.
10. **Location permission.** "Use my location" asks for While Using permission. If permission was already granted, Nearby starts near the person on open, without asking. Search uses `Accuracy.Balanced`. No background location, and no "Always" purpose strings.
11. **Font.** Atkinson Hyperlegible 400 and 700 are copied from `@expo-google-fonts/atkinson-hyperlegible` into the native projects at build time by the `expo-font` config plugin. Nothing is fetched at run time.
    - iOS uses the PostScript names `AtkinsonHyperlegible-Regular` and `AtkinsonHyperlegible-Bold`.
    - Android uses one XML family, `AtkinsonHyperlegible`, with weights 400 and 700.
12. **Colours.** The website's tokens, exactly, in light and dark, following the system appearance. There is no in-app switch.
13. **No third-party SDKs beyond maps.** No `expo-updates`, analytics, crash reporting or `expo-insights`. Icons are the bundled Ionicons font.
14. **Forced upgrade.** `/config` is read at every launch (reuse 0). When the app is below `minSupportedVersion` for its platform:
    - Nearby and Online show the upgrade notice instead of searching;
    - Saved, Me and Help now keep working from saved data.
    - The "Update the app" button opens the website's home page until Phase 6 has store IDs.
    - `isOlderVersion` moves to `packages/shared`, so the server and the app compare versions the same way.
15. **Settings never show the raw app ID** (owner decision 4). Task 12 updates SPEC §8 and §15.
16. **Help now.** A "Help" button in every screen's header opens a sheet with 988 (call or text), SAMHSA (call) and aa.org's meeting finder, in the website's wording. The Me tab and the upgrade notice show the same list.
17. **App version** `0.1.0` until Phase 6. Expo Router's `typedRoutes` stays off, so CI typechecks without starting Metro.
18. **`EXPO_PUBLIC_SERVER_URL` is required.** It names the site and API origin. A missing or malformed value throws, so a build never quietly talks to the wrong server. `eas.json` sets it per profile, and `.env` sets it for local runs.
19. **Network audit.** mitmdump writes a HAR file, and `pnpm --filter network-audit audit` checks it. It fails on:
    - any request to our server beyond the five read shapes;
    - search coordinates that aren't rounded or are outside a POST body;
    - exact test coordinates, the search-box text or a private value (the sobriety date) anywhere;
    - any device header.

    5a captures the iOS simulator (exact coordinates are known through `xcrun simctl location`) and the owner's iPhone. Android waits for 5b.

## Global Constraints

- Everything in `docs/standards.md`:
  - `pnpm check` passes on every commit, and `pnpm knip:production` and `pnpm --filter web test:e2e` pass at the end of the phase.
  - Test-driven: a failing test first.
  - No dead code: each table, helper, fake and config entry lands with its first consumer.
  - One way per concern: the new mobile rows in the standards table.
  - Casts only after runtime checks: SQLite rows, native-module results and route params are parsed with zod.
- Spec §2: "Personal data never leaves the phone: sobriety date, favorites, the local record of tagged meetings, liked flags, notes, meeting log, journal, call list, recent searches, and the search box text."
- Spec §2: "the phone rounds coordinates to 2 decimal places (about 1 km) before sending them, only in the body of the search request." Never in URLs, never logged.
- Spec §2: "While Using only, requested the first time the user taps 'Use my location' … Never at launch. Never in the background."
- Spec §2: "No ads, no analytics SDKs, no tracking."
- Spec §7: "All input is validated with zod schemas shared with the mobile app." Every response the app reads is parsed with its shared contract.
- Spec §8 (5a parts):
  - Maps: "react-native-maps: Apple Maps on iOS, Google Maps on Android".
  - "Filter by day, time, official types, and tags on the phone".
  - "the phone re-sorts by exact distance using the real location, which never leaves the phone".
  - "Directions hand off to Apple Maps or Google Maps".
  - "Our server never receives the query text, only the rounded result point".
  - "Recent searched places are saved on the phone".
  - "If no in-person meetings are found, say so plainly and show the online meetings view".
  - "Online now: meetings in progress … in the user's local time".
  - The sobriety milestones and neutral "set a new date" wording.
  - "Always reachable: 988 and the SAMHSA National Helpline (1-800-662-4357)".
  - "Offline: cache the last search results, online meetings, and favorited meetings' details".
  - "Forced upgrade: … keep offline data (favorites, sobriety counter, crisis numbers) usable".
  - "Do not bundle AA literature text".
- Spec §11: iOS when-in-use purpose string; Android coarse and fine foreground location only.
- Website promises (Phase 4), which the app must keep word for word where it names them:
  - the buttons "Remove my tags" and "Delete all my tags" (5b);
  - "Location permission is optional. Without it, search by city, zip code or address.";
  - the catch-up times;
  - "your exact location, sobriety date and favorites stay on your phone; a search sends only a point rounded to about 1 km."
- Owner decisions (binding, 2026-09-29):
  - The owner has the Apple Developer Program, the Google Play Console and an Expo (EAS) account.
  - Test first on the owner's iPhone (EAS dev build or Xcode) and on simulators.
  - Design "Direction A · Calm", with the website's exact tokens and Atkinson Hyperlegible 400/700 bundled. Card list with tag chips, location button and filter pills; detail with Directions, Save heart, types and "What people say"; bottom tabs Nearby, Online, Saved, Me.
  - Settings never show the raw app ID.
  - The offline cache honours the published catch-up promises, through one shared constant.
  - Merged meetings: the app moves favorites (and in 5b the tag record) to the surviving id.
- Accessibility:
  - every control has a VoiceOver/TalkBack label and role;
  - text scales with Dynamic Type (no `allowFontScaling={false}`, no fixed-height text containers);
  - every touch target is at least 44 × 44 points.
- Nothing in this phase touches production data, Vercel or Neon. Reading production's public API from a dev build is allowed (owner decision 3).
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019qtuWT6wkew2g1c4qi6eKc
  ```

## Review Focus

1. **Offline with a stale saved copy, or offline on a fresh install with no copy at all.** The app must show the saved copy with the time it was saved and say it couldn't reach the server, or, with no copy, say so plainly. It must never spin forever or show an empty list as if nothing existed. Pinned in Task 4 ("shows a stale saved copy with its time when the server can't be reached", "says plainly when there's no saved copy and the server can't be reached") and Task 8 ("labels a saved search shown offline").
2. **A place the geocoder can't find, or a blank search box.** The app must say it couldn't find the place and send nothing to our server. Pinned in Task 7 ("finds nothing for blank text without asking the geocoder") and Task 8 ("a place the geocoder can't find sends nothing to the server").
3. **Location permission denied after tapping "Use my location".** The app must explain, offer Settings, keep the search box working, and never prompt at launch. Pinned in Task 8 ("asks for nothing at launch", "explains a refused permission and keeps place search").
4. **Meetings across midnight, daylight-saving changes and other time zones.** "Happening now" must include a Sunday 11:30 PM–12:30 AM Pacific meeting at 12:15 AM Monday, place a New York meeting in Central time, and resolve the fall-back and spring-forward nights. Pinned in Task 6 ("counts a meeting that crosses midnight as happening after midnight", "takes the earlier instant … when clocks fall back", "moves a time the clocks skip an hour later", and "shows what's happening now and soon, in the phone's local time") and Task 10 ("says when a meeting in another zone is on the phone's clock").
5. **A saved meeting that merged into another, or was removed from the listings.** A merged meeting must stay saved under its new id, with its saved copy moved. A removed one must say it's no longer listed and offer to remove it, without crashing the Saved tab. Pinned in Task 10 ("follows a merged meeting to its new id") and Task 11 ("a merged saved meeting stays saved under its new id", "a meeting no longer listed can be removed").

---

## File structure

```
.github/workflows/ci.yml            + expo install --check for the mobile workspace
eslint.config.js                    mobile rules: react-hooks, no console, no parent imports, one way for fetch, SQLite, location
knip.json                           + apps/mobile, tools/network-audit (tools/* pattern)
CLAUDE.md, docs/standards.md, docs/mobile.md (new), SPEC.md (§8, §15), roadmap
packages/shared/src/freshness.ts    CDN_LIFETIMES, cdnStaleMinutes, CATCH_UP_MINUTES, VOCABULARY_CATCH_UP_HOURS
packages/shared/src/version.ts      + isOlderVersion
packages/test-server/src/index.ts   + optional fixed port, export RecordedRequest
apps/web/src/lib/api/respond.ts     CACHE_POLICIES from CDN_LIFETIMES
apps/web/src/lib/catch-up.ts        deleted (constants now in shared)
apps/web/src/server/devices/write-request.ts   isOlderVersion from shared
apps/web/src/app/(site)/privacy/page.tsx, support/page.tsx, src/server/admin/notices.ts   import from shared
apps/mobile/
  package.json, app.config.ts, eas.json, jest.config.js, tsconfig.json, .gitignore, .env.example
  modules/native-location/          local Expo module: findPlace (Swift + Kotlin)
  src/app/_layout.tsx               root Stack, providers
  src/app/(tabs)/_layout.tsx        Nearby, Online, Saved, Me
  src/app/(tabs)/index.tsx          Nearby (list and map)
  src/app/(tabs)/online.tsx, saved.tsx, me.tsx
  src/app/meeting/[id].tsx          meeting detail
  src/app/help.tsx                  Help now sheet
  src/app/filters.tsx               filter sheet
  src/theme/colors.ts, type.ts      tokens, useColors, FONT, TEXT_STYLES
  src/ui/                           app-text, screen, button, pill, tag-chips, meeting-card, saved-copy-note,
                                    help-resources, help-now-button, upgrade-notice, sobriety-card
  src/config/server-url.ts, app-version.ts, upgrade.tsx
  src/api/client.ts, reads.ts
  src/db/database.ts, migrations.ts
  src/cache/freshness.ts, store.ts, cached-read.ts, use-cached-read.ts, saved-at.ts, prune.ts
  src/time/clock.ts                 clockLabel
  src/meetings/schedule.ts, online-now.ts, type-labels.ts, vocabulary.tsx, directions.ts, merged.ts, units.ts
  src/location/geo.ts, current-position.ts, find-place.ts, recent-places.ts
  src/search/nearby.ts, filters.tsx
  src/saved/favorites.ts
  src/sobriety/counter.ts, sobriety-date.ts
  test/setup.ts, clock.ts, render-app.tsx, api-server.ts, fixtures.ts, app-data.ts
  test/native/expo-sqlite.ts, expo-location.ts, expo-application.ts, native-location.ts,
              react-native-maps.tsx, datetimepicker.tsx
  test/*.test.ts(x)
tools/network-audit/
  package.json, tsconfig.json, vitest.config.ts, src/har.ts, src/audit.ts, src/main.ts, test/audit.test.ts, test/main.test.ts
```

Test files by task:

| Task | Test files                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------ |
| 1    | `packages/shared/test/freshness.test.ts`, `packages/shared/test/version.test.ts` (and web's existing suites) |
| 2    | `apps/mobile/test/app-shell.test.tsx`                                                                        |
| 3    | `apps/mobile/test/api-client.test.ts`                                                                        |
| 4    | `apps/mobile/test/offline-cache.test.tsx`                                                                    |
| 5    | `apps/mobile/test/launch.test.tsx`                                                                           |
| 6    | `apps/mobile/test/schedule.test.ts`, `apps/mobile/test/online-tab.test.tsx`                                  |
| 7    | `apps/mobile/test/location.test.ts`                                                                          |
| 8    | `apps/mobile/test/nearby.test.tsx`, `apps/mobile/test/filters.test.ts`                                       |
| 9    | `apps/mobile/test/map.test.tsx`                                                                              |
| 10   | `apps/mobile/test/meeting-detail.test.tsx`                                                                   |
| 11   | `apps/mobile/test/saved.test.tsx`                                                                            |
| 12   | `apps/mobile/test/sobriety.test.ts`, `apps/mobile/test/me-tab.test.tsx`                                      |
| 13   | `tools/network-audit/test/audit.test.ts`, `tools/network-audit/test/main.test.ts`                            |
| 14   | none (device runs)                                                                                           |

---

### Task 1: Shared freshness and version contracts

The website's catch-up promises and the API's cache lifetimes live in `apps/web` today (`CACHE_POLICIES` in `respond.ts`, `catch-up.ts`), and the app must honour the same numbers (owner decision 5). They move into `packages/shared`, and the web imports them from there. The server's version comparison moves too, so the app's forced upgrade (Task 5) and the server's `upgrade_required` agree. The web changes are refactors under its existing green tests: `catch-up.test.tsx` still derives every promise from the real headers and `vercel.ts`.

**Files:**

- Create: `packages/shared/src/freshness.ts`, `packages/shared/test/freshness.test.ts`
- Modify:
  - `packages/shared/src/index.ts`, `packages/shared/src/version.ts`, `packages/shared/test/version.test.ts`
  - `apps/web/src/lib/api/respond.ts`, `apps/web/src/server/devices/write-request.ts`
  - `apps/web/src/app/(site)/privacy/page.tsx`, `apps/web/src/app/(site)/support/page.tsx`, `apps/web/src/server/admin/notices.ts`
  - `docs/standards.md`
- Delete: `apps/web/src/lib/catch-up.ts`

**Interfaces:**

- Produces (from `@mymeetingapp/shared`):
  - `CDN_LIFETIMES: { vocabulary, config, meetingDetail, onlineMeetings }`, each `{ sMaxAge: number; staleWhileRevalidate: number }` in seconds;
  - `type CdnCachedResponse = keyof typeof CDN_LIFETIMES`;
  - `cdnStaleMinutes(response: CdnCachedResponse): number`;
  - `CATCH_UP_MINUTES: { app: number; feedOptOut: number }` (75 and 90);
  - `VOCABULARY_CATCH_UP_HOURS: number` (25);
  - `isOlderVersion(version: string, minimum: string): boolean`.

- [ ] **Step 1: Write the failing shared tests.** Create `packages/shared/test/freshness.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { CATCH_UP_MINUTES, cdnStaleMinutes, VOCABULARY_CATCH_UP_HOURS } from "../src/index";

describe("cdnStaleMinutes", () => {
  it("is how long the CDN can go on serving a copy: s-maxage plus stale-while-revalidate", () => {
    expect(cdnStaleMinutes("meetingDetail")).toBe(15);
    expect(cdnStaleMinutes("onlineMeetings")).toBe(75);
    expect(cdnStaleMinutes("vocabulary")).toBe(1500);
  });
});

describe("the catch-up promises", () => {
  it("are the slowest meeting response, plus a sync for a feed opt-out", () => {
    expect(CATCH_UP_MINUTES).toEqual({ app: 75, feedOptOut: 90 });
  });

  it("give the tag list a day and an hour", () => {
    expect(VOCABULARY_CATCH_UP_HOURS).toBe(25);
  });
});
```

Append to `packages/shared/test/version.test.ts`:

```ts
describe("isOlderVersion", () => {
  it.each([
    ["1.2.3", "1.2.4", true],
    ["1.2.3", "1.3.0", true],
    ["0.9.9", "1.0.0", true],
    ["1.2.3", "1.2.3", false],
    ["1.10.0", "1.9.9", false],
    ["2.0.0", "1.99.99", false],
  ])("%s below %s is %s", (version, minimum, older) => {
    expect(isOlderVersion(version, minimum)).toBe(older);
  });
});
```

and change its import to `import { isOlderVersion, SemVer } from "../src/index";`.

- [ ] **Step 2: Run to verify they fail.** Run `pnpm --filter @mymeetingapp/shared test`. Expected: FAIL. `cdnStaleMinutes`, `CATCH_UP_MINUTES`, `VOCABULARY_CATCH_UP_HOURS` and `isOlderVersion` are not exported.

- [ ] **Step 3: Implement.** Create `packages/shared/src/freshness.ts`:

```ts
// How long the CDN may serve a copy of each cacheable API response (s-maxage), then keep serving it stale while it
// refetches (stale-while-revalidate), in seconds. The API's Cache-Control headers are built from these, the website's
// "the app catches up within …" promises are worked out from them, and the app reuses its own copies only for what
// the promise has left (owner decision 5, 2026-09-29). Change a lifetime here and all three follow.
export const CDN_LIFETIMES = {
  vocabulary: { sMaxAge: 3600, staleWhileRevalidate: 86_400 },
  config: { sMaxAge: 300, staleWhileRevalidate: 600 },
  meetingDetail: { sMaxAge: 300, staleWhileRevalidate: 600 },
  onlineMeetings: { sMaxAge: 900, staleWhileRevalidate: 3600 },
} as const;

export type CdnCachedResponse = keyof typeof CDN_LIFETIMES;

export function cdnStaleMinutes(response: CdnCachedResponse): number {
  const lifetimes = CDN_LIFETIMES[response];
  return (lifetimes.sMaxAge + lifetimes.staleWhileRevalidate) / 60;
}

// The sync-feeds cron's interval in apps/web/vercel.ts (apps/web/test/catch-up.test.tsx fails if the two differ).
const SYNC_INTERVAL_MINUTES = 15;

const MEETING_MINUTES = Math.max(cdnStaleMinutes("meetingDetail"), cdnStaleMinutes("onlineMeetings"));

// Worst cases the website promises. A change on our server (tags turned off, counts after "Delete all my tags")
// reaches the app once cached meeting responses expire; a feed opt-out waits for the next sync first.
export const CATCH_UP_MINUTES = {
  app: MEETING_MINUTES,
  feedOptOut: SYNC_INTERVAL_MINUTES + MEETING_MINUTES,
} as const;

// The same for the tag list, which the admin notices about new, retired and restored tags promise.
export const VOCABULARY_CATCH_UP_HOURS = cdnStaleMinutes("vocabulary") / 60;
```

Add `export * from "./freshness";` to `packages/shared/src/index.ts`, keeping the list alphabetical. Append to `packages/shared/src/version.ts`:

```ts
// True when `version` is below `minimum` (both like 1.2.3). The server refuses writes from such an app
// (upgrade_required), and the app shows its upgrade screen instead of searching.
export function isOlderVersion(version: string, minimum: string): boolean {
  const [a, b] = [version.split(".").map(Number), minimum.split(".").map(Number)];
  for (let i = 0; i < 3; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}
```

- [ ] **Step 4: Run to verify they pass.** Run `pnpm --filter @mymeetingapp/shared test`. Expected: PASS.

- [ ] **Step 5: Move the web onto the shared constants.** These are refactors under green tests.
  - `apps/web/src/lib/api/respond.ts`:
    - add `CDN_LIFETIMES` to the `@mymeetingapp/shared` import;
    - replace the `CACHE_POLICIES` literal with:

      ```ts
      // null is never cached. The lifetimes live in packages/shared (freshness.ts), because the website's promises and the
      // app's own reuse are worked out from them. Add a policy there when the first route that needs it lands.
      const CACHE_POLICIES = { none: null, ...CDN_LIFETIMES } as const;
      ```

    - delete `staleSeconds`, `MEETING_CACHE_MINUTES` and `VOCABULARY_CACHE_HOURS` with their comments. Keep `cacheControl()`.
  - Delete `apps/web/src/lib/catch-up.ts`.
  - In `privacy/page.tsx` and `support/page.tsx`, replace `import { CATCH_UP_MINUTES } from "@/lib/catch-up";` with `CATCH_UP_MINUTES` added to the existing `@mymeetingapp/shared` import.
  - In `apps/web/src/server/admin/notices.ts`, replace both imports with `import { CATCH_UP_MINUTES, VOCABULARY_CATCH_UP_HOURS } from "@mymeetingapp/shared";`, and rename `VOCABULARY_CACHE_HOURS` to `VOCABULARY_CATCH_UP_HOURS` in its three notices.
  - In `apps/web/src/server/devices/write-request.ts`:
    - delete the private `isOlder` function;
    - add `isOlderVersion` to the `@mymeetingapp/shared` import;
    - call `isOlderVersion(headers.appVersion, readAppConfig().minSupportedVersion[headers.platform])`.
- [ ] **Step 6: Run the web suites.** Run `docker compose up -d`, then `pnpm check` and `pnpm --filter web test:e2e`. Expected: PASS, including `catch-up.test.tsx` (the promises still read 75, 90 and 25 from the real headers and `vercel.ts`) and the write-request tests for `upgrade_required`. `pnpm knip` reports nothing: `catch-up.ts` is gone and the shared exports have consumers.

- [ ] **Step 7: Record the one way.** In `docs/standards.md`, change the "Cache headers" row's one way to: "a named policy in `CACHE_POLICIES` in `respond.ts`, whose lifetimes are `CDN_LIFETIMES` in `packages/shared/src/freshness.ts`. The website's catch-up promises (`CATCH_UP_MINUTES`, `VOCABULARY_CATCH_UP_HOURS`) and the app's reuse windows (`REUSE_MINUTES`) are derived from them; never retype a lifetime". Set its "Enforced by" cell to "review, `catch-up.test.tsx`".

- [ ] **Step 8: Commit.**

```bash
git add packages/shared apps/web/src docs/standards.md
git commit -m "refactor(shared): cache lifetimes, catch-up promises and version comparison move to shared"
```

---

### Task 2: The `apps/mobile` workspace, tooling, theme and tabs

The Expo app joins the monorepo:

- turbo typecheck and test, ESLint, knip and CI all cover it;
- the root layout and four tabs render with the website's colours and font;
- the test harness renders the real `src/app` directory.

**Files:**

- Create:
  - `apps/mobile/package.json`, `apps/mobile/app.config.ts`, `apps/mobile/tsconfig.json`, `apps/mobile/jest.config.js`, `apps/mobile/.gitignore`, `apps/mobile/.env.example`
  - `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/(tabs)/_layout.tsx`
  - `apps/mobile/src/app/(tabs)/index.tsx`, `online.tsx`, `saved.tsx`, `me.tsx`
  - `apps/mobile/src/theme/colors.ts`, `apps/mobile/src/theme/type.ts`
  - `apps/mobile/src/ui/app-text.tsx`, `apps/mobile/src/ui/screen.tsx`
  - `apps/mobile/test/setup.ts`, `apps/mobile/test/render-app.tsx`, `apps/mobile/test/app-shell.test.tsx`
  - `docs/mobile.md`
- Modify: `eslint.config.js`, `knip.json`, `package.json` (root, devDependencies), `.github/workflows/ci.yml`, `docs/standards.md`, `CLAUDE.md`

**Interfaces:**

- Produces:
  - `useColors(): Palette` from `@/theme/colors`, where `Palette` has keys `bg, surface, text, muted, line, accent, accentText, tagBg, noticeBg`, and `PALETTES: { light: Palette; dark: Palette }`;
  - `FONT: { regular: string; bold: string }` and `TEXT_STYLES: Record<TextVariant, TextStyle>`, with `type TextVariant = "title" | "heading" | "body" | "label" | "small"`, from `@/theme/type`;
  - `AppText` from `@/ui/app-text`: props are `TextProps` plus `variant?: TextVariant` and `tone?: "text" | "muted" | "accent"`;
  - `Screen` from `@/ui/screen`: a scrolling, padded, themed page (`children`, `scroll?: boolean`, default `true`);
  - `renderApp(initialUrl?: string)` from `test/render-app.tsx`: renders `src/app` through `renderRouter`;
  - the scripts `pnpm --filter mobile test | typecheck | start | ios | android`.

- [ ] **Step 1: Create the workspace.** Run `mkdir -p apps/mobile/src/app/'(tabs)' apps/mobile/test`. Write `apps/mobile/package.json`:

```json
{
  "name": "mobile",
  "version": "0.0.0",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start --dev-client",
    "ios": "expo run:ios",
    "android": "expo run:android",
    "test": "TZ=America/Chicago jest",
    "typecheck": "tsc --noEmit"
  }
}
```

Then install, letting the SDK choose each native version (see the Tech Stack note):

```bash
pnpm --filter mobile add expo@~57.0.26
pnpm --filter mobile exec expo install expo-router react-native react react-native-screens \
  react-native-safe-area-context expo-linking expo-constants expo-status-bar expo-font expo-dev-client \
  @expo/vector-icons
pnpm --filter mobile add @expo-google-fonts/atkinson-hyperlegible@^0.4.1 @mymeetingapp/shared@workspace:* zod@^4.6.5
pnpm --filter mobile exec expo install jest-expo @types/react -- --save-dev
pnpm --filter mobile add -D jest@^29.7.0 @types/jest@^29.5.14 @testing-library/react-native@^14.0.1 \
  test-renderer@^1.3.0 @react-native/jest-preset@0.86.3 @mymeetingapp/test-server@workspace:*
pnpm add -Dw eslint-plugin-react-hooks@^7.1.1
```

Expected versions: `expo` 57.0.x, `react-native` 0.86.3, `react` 19.2.3 (the web keeps 19.3; pnpm's isolated installs keep them apart), `react-native-screens` ~4.26.0, `react-native-safe-area-context` ~5.7.0 and `jest-expo` ~57.0.5.

- [ ] **Step 2: Configure TypeScript, Jest and git.** Write `apps/mobile/tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "allowJs": true,
    "types": ["jest", "node"],
    "paths": { "@/*": ["./src/*"], "@modules/*": ["./modules/*"] }
  },
  "include": ["src", "test", "modules/*/index.ts", "app.config.ts", "jest.config.js", "expo-env.d.ts"]
}
```

Write `apps/mobile/jest.config.js`:

```js
// Tests read the API from a real local server on this fixed port. Expo may inline EXPO_PUBLIC_* values when it
// transforms a file, so the value is set here, before any transform, and test files share one worker.
process.env.EXPO_PUBLIC_SERVER_URL = "http://127.0.0.1:3197";

// pnpm keeps packages under node_modules/.pnpm/<name>@<version>/node_modules/<name>; these must still be transformed.
const TRANSFORMED = [
  "(jest-)?react-native",
  "@react-native(-community)?",
  "expo(nent)?",
  "@expo(nent)?/.*",
  "@expo-google-fonts/.*",
  "expo-router",
  "react-navigation",
  "@react-navigation/.*",
  "react-native-maps",
].join("|");

/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo/ios",
  maxWorkers: 1,
  setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
  testMatch: ["<rootDir>/test/**/*.test.{ts,tsx}"],
  transformIgnorePatterns: [`node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?(?:${TRANSFORMED}))`],
  // Native modules are faked only here, at their package boundary (docs/standards.md). Fakes come first: the first
  // matching pattern wins.
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
```

Write `apps/mobile/.gitignore`:

```
.expo/
ios/
android/
expo-env.d.ts
*.har
```

Write `apps/mobile/.env.example`:

```
# The site and API origin the app talks to. Production for read-only dev builds (owner decision 3), or your Mac's
# LAN address with `pnpm --filter web dev` running.
EXPO_PUBLIC_SERVER_URL=https://mymeetingapp.vercel.app
```

- [ ] **Step 3: Write the failing shell test.** Create `apps/mobile/test/setup.ts`:

```ts
// Every test starts from a clean slate; later tasks add each fake's reset here as the fake lands.
afterEach(() => {
  jest.useRealTimers();
});
```

Create `apps/mobile/test/render-app.tsx`:

```tsx
import path from "node:path";

import { renderRouter } from "expo-router/testing-library";

const APP_DIR = path.join(__dirname, "..", "src", "app");

// Renders the real app directory, so tests drive the screens and navigation users get.
export function renderApp(initialUrl = "/") {
  return renderRouter(APP_DIR, { initialUrl });
}
```

Create `apps/mobile/test/app-shell.test.tsx`:

```tsx
import { BRAND } from "@mymeetingapp/shared";
import { render, screen } from "@testing-library/react-native";

import { AppText } from "@/ui/app-text";

import { renderApp } from "./render-app";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => "dark",
}));

describe("the app shell", () => {
  it("opens on Nearby, with the four tabs", async () => {
    renderApp("/");
    for (const tab of ["Nearby", "Online", "Saved", "Me"]) {
      expect(await screen.findByLabelText(tab)).toBeOnTheScreen();
    }
    expect(screen.getByText("Search by city, zip code or address, or use your location.")).toBeOnTheScreen();
  });

  it("follows the system's dark appearance with the website's dark tokens and the bundled font", () => {
    render(<AppText variant="label">Welcoming</AppText>);
    expect(screen.getByText("Welcoming")).toHaveStyle({
      color: "#eceff1",
      fontFamily: "AtkinsonHyperlegible-Bold",
    });
  });
});

describe("the app config", () => {
  it("names the app from the brand, with the owner's bundle identifier", () => {
    const config = Config.parse(appConfig({ config: {} }));
    expect(config.name).toBe(BRAND.appName);
    expect(config.ios.bundleIdentifier).toBe("com.goodersoftware.mymeetingapp");
    expect(config.android.package).toBe("com.goodersoftware.mymeetingapp");
  });
});
```

with these additions at the top of the file, after the other imports. The Expo config lives at the workspace root, so this is the one parent-relative import in the app (Step 7 exempts this file):

```tsx
import { z } from "zod";

import appConfig from "../app.config";

const Config = z.object({
  name: z.string(),
  ios: z.object({ bundleIdentifier: z.string() }),
  android: z.object({ package: z.string() }),
});
```

- [ ] **Step 4: Run to verify it fails.** Run `pnpm --filter mobile test`. Expected: FAIL. `src/app` has no routes, and `@/ui/app-text` and `../app.config` don't exist.

- [ ] **Step 5: Implement the theme, text and routes.** Create `apps/mobile/src/theme/colors.ts`:

```ts
import { useColorScheme } from "react-native";

// "Direction A · Calm": the website's tokens exactly (apps/web/src/app/globals.css), light and dark, following the
// system appearance. No other file writes a colour.
export const PALETTES = {
  light: {
    bg: "#fbfaf7",
    surface: "#ffffff",
    text: "#1d2327",
    muted: "#55606a",
    line: "#dcd8cf",
    accent: "#1f5f8b",
    accentText: "#ffffff",
    tagBg: "#eef3f7",
    noticeBg: "#fff6d6",
  },
  dark: {
    bg: "#15191c",
    surface: "#1d2226",
    text: "#eceff1",
    muted: "#a9b3bb",
    line: "#333b41",
    accent: "#8cc4ec",
    accentText: "#0e1418",
    tagBg: "#243039",
    noticeBg: "#3a3218",
  },
} as const;

export type Palette = (typeof PALETTES)["light"] | (typeof PALETTES)["dark"];

export function useColors(): Palette {
  return useColorScheme() === "dark" ? PALETTES.dark : PALETTES.light;
}
```

Create `apps/mobile/src/theme/type.ts`:

```ts
import { Platform, type TextStyle } from "react-native";

// Atkinson Hyperlegible, embedded at build time by the expo-font config plugin (app.config.ts). iOS names a face by its
// PostScript name; Android uses the one XML family and picks the face by weight.
export const FONT = {
  regular: Platform.select({ ios: "AtkinsonHyperlegible-Regular", default: "AtkinsonHyperlegible" }),
  bold: Platform.select({ ios: "AtkinsonHyperlegible-Bold", default: "AtkinsonHyperlegible" }),
} as const;

export type TextVariant = "title" | "heading" | "body" | "label" | "small";

const bold: TextStyle = { fontFamily: FONT.bold, fontWeight: "700" };
const regular: TextStyle = { fontFamily: FONT.regular, fontWeight: "400" };

// Sizes scale with Dynamic Type and Android font size: nothing sets allowFontScaling={false} or a fixed text height.
export const TEXT_STYLES: Record<TextVariant, TextStyle> = {
  title: { ...bold, fontSize: 28, lineHeight: 34 },
  heading: { ...bold, fontSize: 20, lineHeight: 26 },
  body: { ...regular, fontSize: 17, lineHeight: 24 },
  label: { ...bold, fontSize: 17, lineHeight: 22 },
  small: { ...regular, fontSize: 15, lineHeight: 20 },
};
```

Create `apps/mobile/src/ui/app-text.tsx`:

```tsx
import { Text, type TextProps } from "react-native";

import { useColors } from "@/theme/colors";
import { TEXT_STYLES, type TextVariant } from "@/theme/type";

interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: "text" | "muted" | "accent";
}

export function AppText({ variant = "body", tone = "text", style, ...props }: AppTextProps) {
  const colors = useColors();
  return <Text {...props} style={[TEXT_STYLES[variant], { color: colors[tone] }, style]} />;
}
```

Create `apps/mobile/src/ui/screen.tsx`:

```tsx
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { useColors } from "@/theme/colors";

// One left-aligned column with the website's 20-point gutter.
export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const colors = useColors();
  const style = { backgroundColor: colors.bg };
  const content = { padding: 20, gap: 16 };
  if (!scroll) return <View style={[style, content, { flex: 1 }]}>{children}</View>;
  return (
    <ScrollView style={style} contentContainerStyle={content}>
      {children}
    </ScrollView>
  );
}
```

Create `apps/mobile/src/app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { useColors } from "@/theme/colors";
import { FONT } from "@/theme/type";

export default function RootLayout() {
  const colors = useColors();
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.accent,
          headerTitleStyle: { fontFamily: FONT.bold, color: colors.text },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
```

Create `apps/mobile/src/app/(tabs)/_layout.tsx`:

```tsx
import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router/js-tabs";

import { useColors } from "@/theme/colors";
import { FONT } from "@/theme/type";

// The owner's design: Nearby, Online, Saved, Me.
const TABS = [
  { name: "index", title: "Nearby", icon: "location-outline" },
  { name: "online", title: "Online", icon: "videocam-outline" },
  { name: "saved", title: "Saved", icon: "heart-outline" },
  { name: "me", title: "Me", icon: "person-outline" },
] as const;

export default function TabsLayout() {
  const colors = useColors();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { fontFamily: FONT.bold, color: colors.text },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: FONT.regular, fontSize: 13 },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarAccessibilityLabel: tab.title,
            tabBarIcon: ({ color, size }) => <Ionicons name={tab.icon} color={color} size={size} />,
          }}
        />
      ))}
    </Tabs>
  );
}
```

Create the four tab screens, each with its real empty-state sentence (later tasks replace their bodies):

```tsx
// apps/mobile/src/app/(tabs)/index.tsx
import { AppText } from "@/ui/app-text";
import { Screen } from "@/ui/screen";

export default function NearbyScreen() {
  return (
    <Screen>
      <AppText>Search by city, zip code or address, or use your location.</AppText>
    </Screen>
  );
}
```

`online.tsx` exports `OnlineScreen` with "Online meetings happening now appear here.", `saved.tsx` exports `SavedScreen` with "Meetings you save appear here.", and `me.tsx` exports `MeScreen` with "Your sobriety counter and help live here." (Tasks 6, 11 and 12 replace them).

Create `apps/mobile/app.config.ts`:

```ts
import type { ConfigContext, ExpoConfig } from "expo/config";

// The font files ship inside the app, copied at build time from the npm package; nothing is fetched at run time.
const FONTS = "node_modules/@expo-google-fonts/atkinson-hyperlegible";
const REGULAR = `${FONTS}/400Regular/AtkinsonHyperlegible_400Regular.ttf`;
const BOLD = `${FONTS}/700Bold/AtkinsonHyperlegible_700Bold.ttf`;

// BRAND.appName (packages/shared/src/brand.ts); app-shell.test.tsx fails if the two differ.
const APP_NAME = "mymeetingapp";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_NAME,
  slug: APP_NAME,
  scheme: APP_NAME,
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: { bundleIdentifier: "com.goodersoftware.mymeetingapp", supportsTablet: false },
  android: { package: "com.goodersoftware.mymeetingapp" },
  plugins: [
    "expo-router",
    [
      "expo-font",
      {
        ios: { fonts: [REGULAR, BOLD] },
        android: {
          fonts: [
            {
              fontFamily: "AtkinsonHyperlegible",
              fontDefinitions: [
                { path: REGULAR, weight: 400 },
                { path: BOLD, weight: 700 },
              ],
            },
          ],
        },
      },
    ],
  ],
});
```

- [ ] **Step 6: Run to verify it passes.** Run `pnpm --filter mobile test`. Expected: PASS (3 tests). If `renderRouter` can't find the directory, check that `APP_DIR` resolves to `apps/mobile/src/app`.

- [ ] **Step 7: Lint, knip, turbo and CI.** In `eslint.config.js`:
  - add `import reactHooks from "eslint-plugin-react-hooks";`;
  - add `"apps/mobile/.expo/"`, `"apps/mobile/ios/"` and `"apps/mobile/android/"` to `globalIgnores`;
  - append:

```js
  {
    files: ["apps/mobile/**/*.{ts,tsx,js}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // The app logs nothing: no location, search text or device IDs can end up in a device log.
      "no-console": "error",
      "no-restricted-imports": ["error", { patterns: [PARENT_IMPORT] }],
    },
  },
  {
    // The Expo config lives at the workspace root.
    files: ["apps/mobile/test/app-shell.test.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
```

In `knip.json`, add:

```json
    "apps/mobile": {
      "entry": ["src/app/**/*.tsx!", "app.config.ts!", "test/native/*.{ts,tsx}"],
      "project": ["src/**/*.{ts,tsx}!", "modules/*/index.ts!", "test/**/*.{ts,tsx}", "*.{ts,js}"],
      "ignoreDependencies": [
        "expo-dev-client",
        "expo-constants",
        "expo-linking",
        "react-native-screens",
        "react-native-safe-area-context",
        "@expo-google-fonts/atkinson-hyperlegible",
        "@react-native/jest-preset",
        "test-renderer"
      ]
    }
```

Each ignored package is used by native builds, by the Expo Router or Jest presets, or by path from `app.config.ts`, where knip can't see it. Run `pnpm knip`; if it reports any other package, add it only if it's a peer or native-only package of the same kind. Otherwise, remove it.

In `.github/workflows/ci.yml`, after `pnpm check`, add:

```yaml
- name: Mobile packages match Expo SDK 57
  run: pnpm --filter mobile exec expo install --check
```

EAS builds stay manual (docs/mobile.md).

- [ ] **Step 8: Record the one way.** In `docs/standards.md`:
  - under "Real dependencies", add: "In `apps/mobile`, native modules are faked only at their package boundary, by `apps/mobile/test/native/*` mapped in `jest.config.js`, and time only through `setNow()` from `test/clock.ts`. The API is a real HTTP server (`test/api-server.ts`) and SQLite a real engine (sql.js)";
  - under "Location", add: "Mobile tests are `apps/mobile/test/<subject>.test.ts(x)`, run by Jest";
  - add these rows to the table:

| Concern                     | The one way                                                                                                                                                                                                                                                                        | Enforced by |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Tests in `apps/mobile`      | Jest with the `jest-expo/ios` preset, React Native Testing Library, and `renderApp(url)` from `test/render-app.tsx` for screens (the real `src/app` through `expo-router/testing-library`). vitest everywhere else: React Native code needs the React Native Babel and Jest preset | review      |
| Imports in `apps/mobile`    | `@/…` for `src`, `@modules/…` for local native modules, `./` for siblings; never `../`                                                                                                                                                                                             | lint        |
| Colours and text in the app | `useColors()` from `@/theme/colors` and `<AppText variant tone>` from `@/ui/app-text`. No colour literal outside `colors.ts`; no `allowFontScaling={false}`                                                                                                                        | review      |
| Logging in the app          | none: `console` is banned in `apps/mobile`                                                                                                                                                                                                                                         | lint        |

In `CLAUDE.md`, under Commands, add "`pnpm --filter mobile test`: the app's Jest suite (part of `pnpm check`). Device builds and the proxy audit: `docs/mobile.md`."

Create `docs/mobile.md` with a title, "# The mobile app (apps/mobile)", and a "Local setup" section:

1. Install Xcode (with the iOS simulator) and, for Android, Android Studio with an emulator.
2. `cp apps/mobile/.env.example apps/mobile/.env`.
3. `pnpm --filter mobile ios` builds and opens the dev build in the simulator; `pnpm --filter mobile start` serves JavaScript to an installed dev build.

Task 14 fills in the rest.

- [ ] **Step 9: Check and commit.** Run `pnpm check`. Expected: PASS, with the mobile workspace in `typecheck` and `test`. Then:

```bash
git add apps/mobile eslint.config.js knip.json package.json pnpm-lock.yaml .github/workflows/ci.yml docs/standards.md docs/mobile.md CLAUDE.md
git commit -m "feat(mobile): Expo SDK 57 workspace with tabs, calm theme and bundled font"
```

---

### Task 3: The API client for reads

One module talks to the server. It parses every reply with its shared contract, turns the server's error envelope into an `ApiError` carrying the plain-language message, and treats anything else (no connection, a timeout, a reply that breaks the contract) as `Unreachable`. Reads carry no device headers.

**Files:**

- Create: `apps/mobile/src/config/server-url.ts`, `apps/mobile/src/api/client.ts`, `apps/mobile/src/api/reads.ts`, `apps/mobile/test/api-server.ts`, `apps/mobile/test/fixtures.ts`, `apps/mobile/test/api-client.test.ts`
- Modify: `packages/test-server/src/index.ts`, `eslint.config.js`, `docs/standards.md`

**Interfaces:**

- Consumes: `startServer` from `@mymeetingapp/test-server`, which gains an optional second argument, `{ port?: number }`, and exports `RecordedRequest`.
- Produces:
  - `serverUrl(): string` from `@/config/server-url`;
  - `ApiError` (`code: ErrorCode`, `message`), `Unreachable`, `getJson(schema, path)` and `postJson(schema, path, body)` from `@/api/client`. Both return `Promise<z.output<typeof schema>>`;
  - from `@/api/reads`:
    - `fetchConfig(): Promise<AppConfigResponse>`;
    - `fetchVocabulary(): Promise<VocabularyResponse>`;
    - `searchMeetings(request: MeetingSearchRequest): Promise<MeetingSearchResponse>`;
    - `fetchOnlineMeetings(day: number): Promise<OnlineMeetingsResponse>`;
    - `fetchMeeting(id: string): Promise<MeetingDetailResponse>`.
  - Test helpers:
    - `startApi(): Promise<TestApi>` from `test/api-server.ts`, where `TestApi` is `{ requests: RecordedRequest[]; reply(path: string, json: unknown, status?: number): void; hang(path: string): void; close(): Promise<void> }`;
    - `meeting(change?)`, `nearbyMeeting(change?)`, `CONFIG` and `VOCABULARY` from `test/fixtures.ts`.

- [ ] **Step 1: Let the test server listen on a fixed port.** In `packages/test-server/src/index.ts`, export the `RecordedRequest` interface (`export interface RecordedRequest`). Change the signature to `export async function startServer(handler: …, { port = 0 }: { port?: number } = {})` and listen with `server.listen(port, "127.0.0.1", resolve)`. Existing callers pass nothing and still get a random port. Run `pnpm --filter feed-discovery test` and `pnpm --filter web test`. Expected: PASS.

- [ ] **Step 2: Write the test helpers.** Create `apps/mobile/test/api-server.ts`:

```ts
import { type RecordedRequest, startServer } from "@mymeetingapp/test-server";

// jest.config.js points EXPO_PUBLIC_SERVER_URL here.
const API_PORT = 3197;

export interface TestApi {
  requests: RecordedRequest[];
  reply(path: string, json: unknown, status?: number): void;
  // The server takes the request and never answers.
  hang(path: string): void;
  close(): Promise<void>;
}

// A real HTTP server for the app's reads. Paths include the query string; an unexpected path answers 599, which the
// app treats as unreachable, so a test can't pass on a request it didn't expect.
export async function startApi(): Promise<TestApi> {
  const replies = new Map<string, { status: number; json: unknown } | "hang">();
  const server = await startServer(
    (path) => {
      const reply = replies.get(path);
      if (reply === "hang") return new Promise(() => undefined);
      if (reply === undefined) return { status: 599, body: `no reply set for ${path}` };
      return {
        status: reply.status,
        body: JSON.stringify(reply.json),
        headers: { "content-type": "application/json" },
      };
    },
    { port: API_PORT },
  );
  return {
    requests: server.requests,
    reply: (path, json, status = 200) => {
      replies.set(path, { status, json });
    },
    hang: (path) => {
      replies.set(path, "hang");
    },
    close: server.close,
  };
}
```

Create `apps/mobile/test/fixtures.ts`:

```ts
import {
  type AppConfigResponse,
  MeetingSearchResponse,
  MeetingSummary,
  STARTER_VOCABULARY,
  type VocabularyResponse,
} from "@mymeetingapp/shared";

// Every fixture is parsed through its shared contract, so a fixture can't drift from what the server sends.
const BASE = MeetingSummary.parse({
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  name: "Nooners",
  day: 1,
  time: "12:00",
  endTime: "13:00",
  timezone: "America/Chicago",
  types: ["O", "B"],
  attendance: "in_person",
  locationName: "St. Luke's",
  formattedAddress: "1 Main St, Nashville, TN 37203, USA",
  latitude: 36.1627,
  longitude: -86.7816,
  locationNotes: null,
  notes: null,
  groupName: null,
  conferenceUrl: null,
  conferenceUrlNotes: null,
  conferencePhone: null,
  conferencePhoneNotes: null,
  sourceUrl: "https://aanashville.org/meetings/nooners",
  tagsDisabled: false,
  tags: [{ slug: "welcoming", count: 14 }],
});

export function meeting(change: Partial<MeetingSummary> = {}): MeetingSummary {
  return MeetingSummary.parse({ ...BASE, ...change });
}

type SearchMeeting = MeetingSearchResponse["meetings"][number];

export function nearbyMeeting(change: Partial<SearchMeeting> = {}): SearchMeeting {
  const parsed = MeetingSearchResponse.parse({ meetings: [{ ...BASE, distanceKm: 1.2, ...change }] })
    .meetings[0];
  if (parsed === undefined) throw new Error("unreachable: one meeting in, one out");
  return parsed;
}

export const CONFIG: AppConfigResponse = {
  minSupportedVersion: { ios: "0.0.0", android: "0.0.0" },
  latestVersion: { ios: "0.1.0", android: "0.1.0" },
  features: { tagging: true, suggestions: true },
};

export const VOCABULARY: VocabularyResponse = { tags: [...STARTER_VOCABULARY] };
```

- [ ] **Step 3: Write the failing client tests.** Create `apps/mobile/test/api-client.test.ts`:

```ts
import { MeetingSearchRequest } from "@mymeetingapp/shared";

import { ApiError, Unreachable } from "@/api/client";
import { fetchMeeting, fetchOnlineMeetings, fetchVocabulary, searchMeetings } from "@/api/reads";

import { startApi, type TestApi } from "./api-server";
import { meeting, VOCABULARY } from "./fixtures";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
let api: TestApi;

beforeEach(async () => {
  api = await startApi();
});
afterEach(async () => {
  await api.close();
});

describe("reads", () => {
  it("reads the tag list through its contract, with no device headers", async () => {
    api.reply("/api/v1/vocabulary", VOCABULARY);
    expect(await fetchVocabulary()).toEqual(VOCABULARY);
    const [request] = api.requests;
    expect(request?.method).toBe("GET");
    for (const header of ["x-device-id", "x-platform", "x-app-version", "x-attestation"]) {
      expect(request?.headers[header]).toBeUndefined();
    }
  });

  it("drops fields the contract doesn't name", async () => {
    api.reply(`/api/v1/meetings/${ID}`, { meeting: { ...meeting(), internalNote: "x" } });
    expect(await fetchMeeting(ID)).toEqual({ meeting: meeting() });
  });

  it("reads one weekday of online meetings", async () => {
    api.reply("/api/v1/meetings/online?day=3", { meetings: [] });
    expect(await fetchOnlineMeetings(3)).toEqual({ meetings: [] });
  });
});

describe("search", () => {
  it("sends only the rounded point and radius, in the POST body and never the URL", async () => {
    api.reply("/api/v1/meetings/search", { meetings: [] });
    await searchMeetings({ lat: 36.16, lng: -86.78, radiusKm: 25 });
    const [request] = api.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/api/v1/meetings/search");
    expect(JSON.parse(request?.body ?? "")).toEqual({ lat: 36.16, lng: -86.78, radiusKm: 25 });
  });

  it("refuses to send a point that isn't rounded", async () => {
    await expect(searchMeetings({ lat: 36.162, lng: -86.78, radiusKm: 25 })).rejects.toThrow();
    expect(api.requests).toHaveLength(0);
    expect(MeetingSearchRequest.safeParse({ lat: 36.162, lng: -86.78, radiusKm: 25 }).success).toBe(false);
  });
});

describe("failures", () => {
  it("turns the server's error envelope into its code and plain-language message", async () => {
    const message = "We couldn't find that meeting. It may have been removed from the meeting list.";
    api.reply(`/api/v1/meetings/${ID}`, { error: { code: "meeting_not_found", message } }, 404);
    const error: unknown = await fetchMeeting(ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: "meeting_not_found", message });
  });

  it("treats a reply that breaks the contract as unreachable", async () => {
    api.reply(`/api/v1/meetings/${ID}`, { meeting: { ...meeting(), day: 9 } });
    await expect(fetchMeeting(ID)).rejects.toBeInstanceOf(Unreachable);
  });

  it("treats a refused connection as unreachable", async () => {
    await api.close();
    await expect(fetchVocabulary()).rejects.toBeInstanceOf(Unreachable);
    api = await startApi();
  });

  it("gives up on a server that doesn't answer within 15 seconds", async () => {
    jest.useFakeTimers({
      doNotFake: ["Date", "nextTick", "setImmediate", "queueMicrotask", "setInterval", "clearInterval"],
    });
    api.hang("/api/v1/vocabulary");
    const pending = fetchVocabulary().catch((caught: unknown) => caught);
    while (api.requests.length === 0) await new Promise((resolve) => setImmediate(resolve));
    await jest.advanceTimersByTimeAsync(14_999);
    await jest.advanceTimersByTimeAsync(1);
    expect(await pending).toBeInstanceOf(Unreachable);
  });
});
```

- [ ] **Step 4: Run to verify they fail.** Run `pnpm --filter mobile test -- api-client`. Expected: FAIL. `@/api/client` and `@/api/reads` don't exist.

- [ ] **Step 5: Implement.** Create `apps/mobile/src/config/server-url.ts`:

```ts
// The one origin the app talks to: the website and its API. eas.json sets it per build profile, and .env sets it for
// local runs. Missing or malformed throws, so a build never talks to a server nobody chose. Expo inlines
// process.env.EXPO_PUBLIC_* at build time only when it is read exactly like this.
export function serverUrl(): string {
  const value = process.env.EXPO_PUBLIC_SERVER_URL?.replace(/\/$/, "");
  if (value === undefined || !/^https?:\/\/[^/]+$/.test(value)) {
    throw new Error(
      "EXPO_PUBLIC_SERVER_URL must be an http(s) origin such as https://mymeetingapp.vercel.app",
    );
  }
  return value;
}
```

Create `apps/mobile/src/api/client.ts`:

```ts
import { ApiErrorBody, type ErrorCode } from "@mymeetingapp/shared";
import type { z } from "zod";

import { serverUrl } from "@/config/server-url";

const TIMEOUT_MS = 15_000;

// The server refused the request with one of its codes; `message` is plain language the app shows as it is.
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// No usable answer: no connection, a timeout, or a reply that isn't the contract (a newer server, a captive portal).
// Readers fall back to a saved copy.
export class Unreachable extends Error {
  constructor() {
    super("The server couldn't be reached");
    this.name = "Unreachable";
  }
}

function unreachable(): never {
  throw new Unreachable();
}

function parseReply<S extends z.ZodType>(ok: boolean, body: unknown, schema: S): z.output<S> {
  if (!ok) {
    const failure = ApiErrorBody.safeParse(body);
    if (failure.success) throw new ApiError(failure.data.error.code, failure.data.error.message);
    return unreachable();
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : unreachable();
}

async function request<S extends z.ZodType>(
  schema: S,
  path: string,
  init: RequestInit,
): Promise<z.output<S>> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);
  try {
    const response = await fetch(`${serverUrl()}${path}`, { ...init, signal: controller.signal }).catch(
      unreachable,
    );
    const body: unknown = await response.json().catch(unreachable);
    return parseReply(response.ok, body, schema);
  } finally {
    clearTimeout(timer);
  }
}

// Reads send nothing that identifies the phone: no device headers, no cookies.
export function getJson<S extends z.ZodType>(schema: S, path: string): Promise<z.output<S>> {
  return request(schema, path, { headers: { Accept: "application/json" } });
}

export function postJson<S extends z.ZodType>(schema: S, path: string, body: unknown): Promise<z.output<S>> {
  return request(schema, path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
```

Create `apps/mobile/src/api/reads.ts`:

```ts
import {
  AppConfigResponse,
  MeetingDetailResponse,
  MeetingSearchRequest,
  MeetingSearchResponse,
  OnlineMeetingsResponse,
  VocabularyResponse,
} from "@mymeetingapp/shared";

import { getJson, postJson } from "@/api/client";

export const fetchConfig = () => getJson(AppConfigResponse, "/api/v1/config");

export const fetchVocabulary = () => getJson(VocabularyResponse, "/api/v1/vocabulary");

// Spec §2: the point is rounded to 2 decimals before it leaves the phone, and travels only in this POST body. Parsing
// with the shared schema first means an unrounded point throws here instead of being sent.
export const searchMeetings = (request: MeetingSearchRequest) =>
  postJson(MeetingSearchResponse, "/api/v1/meetings/search", MeetingSearchRequest.parse(request));

export const fetchOnlineMeetings = (day: number) =>
  getJson(OnlineMeetingsResponse, `/api/v1/meetings/online?day=${String(day)}`);

export const fetchMeeting = (id: string) =>
  getJson(MeetingDetailResponse, `/api/v1/meetings/${encodeURIComponent(id)}`);
```

- [ ] **Step 6: Run to verify they pass.** Run `pnpm --filter mobile test -- api-client`. Expected: PASS (9 tests).

- [ ] **Step 7: One way to reach the network.** In the mobile block of `eslint.config.js`, add `"no-restricted-globals": ["error", { name: "fetch", message: "Use getJson/postJson from @/api/client." }]`, and add a block that turns it off for `apps/mobile/src/api/client.ts` only. In `docs/standards.md`, add the row:

| Concern                 | The one way                                                                                                                                                                                                                                                                     | Enforced by                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| The app's network calls | `getJson` / `postJson` from `@/api/client` (15-second timeout, reply parsed with its shared contract; the server's error envelope becomes `ApiError`, anything else `Unreachable`). Endpoint functions live in `@/api/reads` (5b adds writes). Reads never carry device headers | lint bans `fetch` elsewhere in `apps/mobile` |

- [ ] **Step 8: Check and commit.** Run `pnpm check`, then:

```bash
git add apps/mobile packages/test-server eslint.config.js docs/standards.md
git commit -m "feat(mobile): API client for reads, validated with the shared contracts"
```

---

### Task 4: The phone's database and the offline cache

One SQLite database holds everything the phone keeps. `cachedRead` decides between the saved copy and the server:

- it reuses a copy only inside `REUSE_MINUTES`, which is derived from the shared catch-up promises (owner decision 5);
- otherwise it asks the server and saves the answer;
- when the server can't be reached, it returns the older copy together with the time it was saved, which screens must show with `<SavedCopyNote>`.

**Files:**

- Create:
  - `apps/mobile/src/db/database.ts`, `apps/mobile/src/db/migrations.ts`
  - `apps/mobile/src/cache/freshness.ts`, `store.ts`, `cached-read.ts`, `use-cached-read.ts`, `saved-at.ts`, `apps/mobile/src/time/clock.ts`
  - `apps/mobile/src/ui/saved-copy-note.tsx`
  - `apps/mobile/test/native/expo-sqlite.ts`, `apps/mobile/test/app-data.ts`, `apps/mobile/test/clock.ts`, `apps/mobile/test/offline-cache.test.tsx`
- Modify: `apps/mobile/jest.config.js`, `apps/mobile/test/setup.ts`, `apps/mobile/package.json`, `eslint.config.js`, `docs/standards.md`

**Interfaces:**

- Consumes: `CATCH_UP_MINUTES`, `VOCABULARY_CATCH_UP_HOURS` and `cdnStaleMinutes` (Task 1); `Unreachable` and `ApiError` (Task 3).
- Produces:
  - `appDatabase(): Promise<AppDatabase>` from `@/db/database`, where `AppDatabase` is `Pick<SQLiteDatabase, "execAsync" | "runAsync" | "getAllAsync" | "getFirstAsync" | "withTransactionAsync">`. SQL parameters are always passed as an array;
  - `MIGRATIONS: readonly string[]` from `@/db/migrations` (append-only);
  - `REUSE_MINUTES`, `type CacheKind = keyof typeof REUSE_MINUTES` (`"search" | "meetingDetail" | "onlineMeetings" | "vocabulary" | "config"`) and `isFresh(kind, savedAt: Date, now: Date): boolean` from `@/cache/freshness`;
  - from `@/cache/store`:
    - `readCache(key: string): Promise<{ body: unknown; savedAt: Date } | null>`;
    - `writeCache(key: string, body: unknown): Promise<void>`;
    - `forgetOtherSearches(keep: string): Promise<void>`;
  - `CachedRead<S>` (`{ kind: CacheKind; key: string; schema: S; fetch: () => Promise<z.output<S>> }`), `CachedResult<T>` (`{ data: T; savedAt: Date | null }`, where `savedAt` is non-null only for a stale copy shown because the server was unreachable) and `cachedRead(read)` from `@/cache/cached-read`;
  - `useCachedRead(read: CachedRead<S> | null): { state: ReadState<z.output<S>>; refresh(): void }` from `@/cache/use-cached-read`, where `ReadState<T> = { status: "loading" } | { status: "ready"; data: T; savedAt: Date | null } | { status: "failed"; message: string }`;
  - `savedAtLabel(savedAt: Date, now: Date): string` from `@/cache/saved-at`, and `clockLabel(hour: number, minute: number): string` ("7:05 PM") from `@/time/clock`;
  - `<SavedCopyNote savedAt={Date} />` from `@/ui/saved-copy-note`;
  - test helpers: `resetAppData()` from `test/app-data.ts` and `setNow(iso: string)` from `test/clock.ts`.
- Cache keys: `search:<lat>,<lng>,<radiusKm>` (rounded values), `meeting:<id>`, `online:<day>`, `vocabulary` and `config`.

- [ ] **Step 1: Fake SQLite with a real engine, and add the test helpers.** Run `pnpm --filter mobile exec expo install expo-sqlite` and `pnpm --filter mobile add -D sql.js@^1.14.2 @types/sql.js@^1.4.11`. Create `apps/mobile/test/native/expo-sqlite.ts`:

```ts
import initSqlJs, { type Database, type SqlValue } from "sql.js";

type Params = SqlValue[];

// expo-sqlite's async API, as far as the app uses it, over a real SQLite engine (sql.js), so every SQL statement the
// app writes runs for real in tests. Each open is a fresh in-memory database; Jest gives each test file its own
// module registry, so each file gets its own database.
class FakeDatabase {
  constructor(private readonly db: Database) {}

  execAsync(source: string): Promise<void> {
    this.db.exec(source);
    return Promise.resolve();
  }

  runAsync(source: string, params: Params): Promise<{ changes: number; lastInsertRowId: number }> {
    this.db.run(source, params);
    return Promise.resolve({ changes: this.db.getRowsModified(), lastInsertRowId: 0 });
  }

  getAllAsync(source: string, params: Params): Promise<Record<string, SqlValue>[]> {
    const statement = this.db.prepare(source);
    statement.bind(params);
    const rows: Record<string, SqlValue>[] = [];
    while (statement.step()) rows.push(statement.getAsObject());
    statement.free();
    return Promise.resolve(rows);
  }

  async getFirstAsync(source: string, params: Params): Promise<Record<string, SqlValue> | null> {
    return (await this.getAllAsync(source, params))[0] ?? null;
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.db.exec("begin");
    try {
      await task();
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }
}

const engine = initSqlJs();

export async function openDatabaseAsync(_name: string): Promise<FakeDatabase> {
  return new FakeDatabase(new (await engine).Database());
}
```

In `jest.config.js`, add to `moduleNameMapper`, above `"^@/(.*)$"`: `"^expo-sqlite$": "<rootDir>/test/native/expo-sqlite.ts",`.

Create `apps/mobile/test/clock.ts`:

```ts
// Fakes the clock only: timers, promises and sockets stay real, so HTTP tests keep working.
export function setNow(iso: string): void {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });
}
```

Create `apps/mobile/test/app-data.ts`:

```ts
import { appDatabase } from "@/db/database";

// Every table the app keeps, emptied between tests. Add each new table here in the task that creates it.
const TABLES = ["cache_entries"] as const;

export async function resetAppData(): Promise<void> {
  const db = await appDatabase();
  for (const table of TABLES) await db.execAsync(`delete from ${table}`);
}
```

- [ ] **Step 2: Write the failing tests.** Create `apps/mobile/test/offline-cache.test.tsx`:

```tsx
import { VocabularyResponse } from "@mymeetingapp/shared";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { fetchVocabulary } from "@/api/reads";
import { cachedRead } from "@/cache/cached-read";
import { isFresh } from "@/cache/freshness";
import { savedAtLabel } from "@/cache/saved-at";
import { readCache, writeCache } from "@/cache/store";
import { useCachedRead } from "@/cache/use-cached-read";
import { SavedCopyNote } from "@/ui/saved-copy-note";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { VOCABULARY } from "./fixtures";

let api: TestApi;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
});
afterEach(async () => {
  await api.close();
});

const minutesAfter = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * 60_000);
const SAVED = "2026-10-05T20:40:00.000Z";

describe("isFresh: the app's reuse never outlasts the website's promises", () => {
  it.each([
    ["search", 74, true],
    ["search", 75, false],
    ["meetingDetail", 59, true],
    ["meetingDetail", 60, false],
    ["onlineMeetings", 0.01, false],
    ["vocabulary", 0.01, false],
    ["config", 0.01, false],
  ] as const)("a %s copy %s minutes old is fresh: %s", (kind, minutes, fresh) => {
    expect(isFresh(kind, new Date(SAVED), minutesAfter(SAVED, minutes))).toBe(fresh);
  });
});

const vocabularyRead = {
  kind: "vocabulary",
  key: "vocabulary",
  schema: VocabularyResponse,
  fetch: fetchVocabulary,
} as const;
const searchRead = (key: string) =>
  ({ kind: "search", key, schema: VocabularyResponse, fetch: fetchVocabulary }) as const;

describe("cachedRead", () => {
  it("asks the server and saves the answer when nothing is saved", async () => {
    api.reply("/api/v1/vocabulary", VOCABULARY);
    expect(await cachedRead(vocabularyRead)).toEqual({ data: VOCABULARY, savedAt: null });
    expect((await readCache("vocabulary"))?.body).toEqual(VOCABULARY);
  });

  it("reuses a copy inside its window without asking the server", async () => {
    setNow(SAVED);
    await writeCache("search:36.16,-86.78,25", VOCABULARY);
    setNow(minutesAfter(SAVED, 74).toISOString());
    expect(await cachedRead(searchRead("search:36.16,-86.78,25"))).toEqual({
      data: VOCABULARY,
      savedAt: null,
    });
    expect(api.requests).toHaveLength(0);
  });

  it("asks again once the window has passed", async () => {
    setNow(SAVED);
    await writeCache("search:36.16,-86.78,25", VOCABULARY);
    setNow(minutesAfter(SAVED, 75).toISOString());
    api.reply("/api/v1/vocabulary", VOCABULARY);
    await cachedRead(searchRead("search:36.16,-86.78,25"));
    expect(api.requests).toHaveLength(1);
  });

  it("shows a stale saved copy with its time when the server can't be reached", async () => {
    setNow(SAVED);
    await writeCache("vocabulary", VOCABULARY);
    setNow(minutesAfter(SAVED, 120).toISOString());
    await api.close();
    expect(await cachedRead(vocabularyRead)).toEqual({ data: VOCABULARY, savedAt: new Date(SAVED) });
    api = await startApi();
  });

  it("says plainly when there's no saved copy and the server can't be reached", async () => {
    await api.close();
    await expect(cachedRead(vocabularyRead)).rejects.toThrow("The server couldn't be reached");
    api = await startApi();
  });

  it("passes the server's refusal through even when a copy is saved", async () => {
    setNow(SAVED);
    await writeCache("vocabulary", VOCABULARY);
    setNow(minutesAfter(SAVED, 1).toISOString());
    api.reply(
      "/api/v1/vocabulary",
      { error: { code: "server_error", message: "Something went wrong on our end." } },
      500,
    );
    await expect(cachedRead(vocabularyRead)).rejects.toMatchObject({ code: "server_error" });
  });

  it("ignores a saved copy that no longer matches the contract", async () => {
    await writeCache("vocabulary", { tags: "not a list" });
    api.reply("/api/v1/vocabulary", VOCABULARY);
    expect(await cachedRead(vocabularyRead)).toEqual({ data: VOCABULARY, savedAt: null });
  });

  it("keeps only the latest search", async () => {
    api.reply("/api/v1/vocabulary", VOCABULARY);
    await cachedRead(searchRead("search:36.16,-86.78,25"));
    await cachedRead(searchRead("search:35.96,-83.92,25"));
    expect(await readCache("search:36.16,-86.78,25")).toBeNull();
    expect(await readCache("search:35.96,-83.92,25")).not.toBeNull();
  });
});

describe("savedAtLabel", () => {
  it.each([
    ["2026-10-05T20:40:00.000Z", "2026-10-05T23:00:00.000Z", "today at 3:40 PM"],
    ["2026-10-04T05:05:00.000Z", "2026-10-05T23:00:00.000Z", "yesterday at 12:05 AM"],
    ["2026-09-27T17:00:00.000Z", "2026-10-05T23:00:00.000Z", "on Sep 27 at 12:00 PM"],
  ])("%s seen at %s reads %j", (saved, now, label) => {
    expect(savedAtLabel(new Date(saved), new Date(now))).toBe(label);
  });
});

function VocabularyCount() {
  const { state } = useCachedRead(vocabularyRead);
  if (state.status === "loading") return <Text>Loading</Text>;
  if (state.status === "failed") return <Text>{state.message}</Text>;
  return (
    <>
      {state.savedAt !== null && <SavedCopyNote savedAt={state.savedAt} />}
      <Text>{`${String(state.data.tags.length)} tags`}</Text>
    </>
  );
}

describe("useCachedRead with SavedCopyNote", () => {
  it("labels a saved copy shown because the server can't be reached", async () => {
    setNow(SAVED);
    await writeCache("vocabulary", VOCABULARY);
    setNow(minutesAfter(SAVED, 30).toISOString());
    await api.close();
    render(<VocabularyCount />);
    expect(await screen.findByText("26 tags")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Showing the copy saved today at 3:40 PM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    api = await startApi();
  });

  it("says so when there's nothing saved and no connection", async () => {
    await api.close();
    render(<VocabularyCount />);
    expect(
      await screen.findByText(
        "We couldn't reach mymeetingapp, and there's no saved copy on this phone yet. Check your connection and try again.",
      ),
    ).toBeOnTheScreen();
    api = await startApi();
  });
});
```

(Times read in the phone's zone, America/Chicago, which the test script sets. 20:40Z is 3:40 PM CDT.)

- [ ] **Step 3: Run to verify they fail.** Run `pnpm --filter mobile test -- offline-cache`. Expected: FAIL. The modules don't exist.

- [ ] **Step 4: Implement the database.** Create `apps/mobile/src/db/migrations.ts`:

```ts
// Append-only. Each entry runs once, in order, and is never edited after it ships: the phone's `user_version` counts
// how many have run. Everything here stays on the phone (spec §2, §13).
export const MIGRATIONS: readonly string[] = [
  `create table cache_entries (key text primary key, body text not null, saved_at integer not null) strict;`,
];
```

Create `apps/mobile/src/db/database.ts`:

```ts
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { z } from "zod";

import { MIGRATIONS } from "@/db/migrations";

export type AppDatabase = Pick<
  SQLiteDatabase,
  "execAsync" | "runAsync" | "getAllAsync" | "getFirstAsync" | "withTransactionAsync"
>;

const Version = z.object({ user_version: z.number().int() });

async function migrate(db: AppDatabase): Promise<AppDatabase> {
  const { user_version: current } = Version.parse(await db.getFirstAsync("pragma user_version", []));
  for (const [index, statement] of MIGRATIONS.entries()) {
    if (index < current) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(statement);
      await db.execAsync(`pragma user_version = ${String(index + 1)}`);
    });
  }
  return db;
}

let opening: Promise<AppDatabase> | undefined;

// The one database for everything the phone keeps: saved server responses and personal data. It never leaves the
// phone except in the phone's own backups (owner decision 6).
export function appDatabase(): Promise<AppDatabase> {
  opening ??= openDatabaseAsync("mymeetingapp.db").then(migrate);
  return opening;
}
```

- [ ] **Step 5: Implement the cache.** Create `apps/mobile/src/cache/freshness.ts`:

```ts
import { CATCH_UP_MINUTES, cdnStaleMinutes, VOCABULARY_CATCH_UP_HOURS } from "@mymeetingapp/shared";

// How long the app may keep showing its own copy without asking again. The CDN may already have held that copy for
// as long as cdnStaleMinutes, so the two together never pass what the website promises: tag changes and opt-outs
// reach the app within CATCH_UP_MINUTES.app, and tag-list changes within VOCABULARY_CATCH_UP_HOURS (owner decision 5,
// 2026-09-29). /config is read at every launch.
export const REUSE_MINUTES = {
  // A POST, never cached by the CDN.
  search: CATCH_UP_MINUTES.app,
  meetingDetail: CATCH_UP_MINUTES.app - cdnStaleMinutes("meetingDetail"),
  onlineMeetings: CATCH_UP_MINUTES.app - cdnStaleMinutes("onlineMeetings"),
  vocabulary: VOCABULARY_CATCH_UP_HOURS * 60 - cdnStaleMinutes("vocabulary"),
  config: 0,
} as const;

export type CacheKind = keyof typeof REUSE_MINUTES;

export function isFresh(kind: CacheKind, savedAt: Date, now: Date): boolean {
  return now.getTime() - savedAt.getTime() < REUSE_MINUTES[kind] * 60_000;
}
```

Create `apps/mobile/src/cache/store.ts`:

```ts
import { z } from "zod";

import { appDatabase } from "@/db/database";

const Row = z.object({ body: z.string(), saved_at: z.number() });

export async function readCache(key: string): Promise<{ body: unknown; savedAt: Date } | null> {
  const db = await appDatabase();
  const row = await db.getFirstAsync("select body, saved_at from cache_entries where key = ?", [key]);
  if (row === null) return null;
  const { body, saved_at } = Row.parse(row);
  return { body: JSON.parse(body) as unknown, savedAt: new Date(saved_at) };
}

export async function writeCache(key: string, body: unknown): Promise<void> {
  const db = await appDatabase();
  await db.runAsync("insert or replace into cache_entries (key, body, saved_at) values (?, ?, ?)", [
    key,
    JSON.stringify(body),
    Date.now(),
  ]);
}

// Spec §8 keeps only the last search results offline.
export async function forgetOtherSearches(keep: string): Promise<void> {
  const db = await appDatabase();
  await db.runAsync("delete from cache_entries where key like 'search:%' and key <> ?", [keep]);
}
```

Create `apps/mobile/src/cache/cached-read.ts`:

```ts
import type { z } from "zod";

import { Unreachable } from "@/api/client";
import { type CacheKind, isFresh } from "@/cache/freshness";
import { forgetOtherSearches, readCache, writeCache } from "@/cache/store";

export interface CachedRead<S extends z.ZodType> {
  kind: CacheKind;
  key: string;
  schema: S;
  fetch: () => Promise<z.output<S>>;
}

// savedAt is set only for a copy older than its reuse window, shown because the server couldn't be reached; the
// screen must say so with <SavedCopyNote>.
export interface CachedResult<T> {
  data: T;
  savedAt: Date | null;
}

async function savedCopy<S extends z.ZodType>(read: CachedRead<S>) {
  const saved = await readCache(read.key);
  if (saved === null) return null;
  // A copy saved by an older app version may not match today's contract; then it's as good as missing.
  const parsed = read.schema.safeParse(saved.body);
  return parsed.success ? { data: parsed.data, savedAt: saved.savedAt } : null;
}

export async function cachedRead<S extends z.ZodType>(
  read: CachedRead<S>,
): Promise<CachedResult<z.output<S>>> {
  const saved = await savedCopy(read);
  if (saved !== null && isFresh(read.kind, saved.savedAt, new Date()))
    return { data: saved.data, savedAt: null };
  try {
    const data = await read.fetch();
    await writeCache(read.key, data);
    if (read.kind === "search") await forgetOtherSearches(read.key);
    return { data, savedAt: null };
  } catch (error) {
    if (error instanceof Unreachable && saved !== null) return saved;
    throw error;
  }
}
```

The `as unknown` in `readCache` widens `any` to `unknown`, the type every reader must then parse. It narrows nothing.

Create `apps/mobile/src/time/clock.ts` (Task 6's meeting times use it too):

```ts
// "7:05 PM", formatted by hand so the text doesn't depend on the phone's ICU version (the app is US English).
export function clockLabel(hour: number, minute: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(twelve)}:${String(minute).padStart(2, "0")} ${suffix}`;
}
```

Create `apps/mobile/src/cache/saved-at.ts`:

```ts
import { clockLabel } from "@/time/clock";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// When a saved copy was saved, in the phone's local time: "today at 3:40 PM", "yesterday at …", "on Sep 27 at …".
export function savedAtLabel(savedAt: Date, now: Date): string {
  const time = clockLabel(savedAt.getHours(), savedAt.getMinutes());
  const days = Math.round((dayStart(now) - dayStart(savedAt)) / 86_400_000);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  return `on ${MONTHS[savedAt.getMonth()] ?? ""} ${String(savedAt.getDate())} at ${time}`;
}
```

Create `apps/mobile/src/cache/use-cached-read.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";

import { ApiError, Unreachable } from "@/api/client";
import { cachedRead, type CachedRead } from "@/cache/cached-read";

export type ReadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T; savedAt: Date | null }
  | { status: "failed"; message: string };

const NO_COPY =
  "We couldn't reach mymeetingapp, and there's no saved copy on this phone yet. Check your connection and try again.";

function failureMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Unreachable) return NO_COPY;
  throw error;
}

// Reads `read` whenever its key changes, and again on refresh(); a refresh keeps showing what's already there.
export function useCachedRead<S extends z.ZodType>(read: CachedRead<S> | null) {
  const [state, setState] = useState<ReadState<z.output<S>>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(read);
  latest.current = read;
  const key = read?.key ?? null;
  const shownKey = useRef<string | null>(null);

  useEffect(() => {
    const current = latest.current;
    if (current === null) return;
    let live = true;
    if (shownKey.current !== current.key) setState({ status: "loading" });
    shownKey.current = current.key;
    cachedRead(current).then(
      (result) => {
        if (live) setState({ status: "ready", ...result });
      },
      (error: unknown) => {
        if (live) setState({ status: "failed", message: failureMessage(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [key, attempt]);

  const refresh = useCallback(() => {
    setAttempt((count) => count + 1);
  }, []);
  return { state, refresh };
}
```

Create `apps/mobile/src/ui/saved-copy-note.tsx`:

```tsx
import { View } from "react-native";

import { savedAtLabel } from "@/cache/saved-at";
import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

// Owner decision 5: data older than the website's catch-up promise is shown only offline, and always says so.
export function SavedCopyNote({ savedAt }: { savedAt: Date }) {
  const colors = useColors();
  return (
    <View
      accessibilityRole="alert"
      style={{ backgroundColor: colors.noticeBg, padding: 12, borderRadius: 8 }}
    >
      <AppText variant="small">
        {`Showing the copy saved ${savedAtLabel(savedAt, new Date())}. We couldn't reach mymeetingapp, so it may be out of date.`}
      </AppText>
    </View>
  );
}
```

- [ ] **Step 6: Run to verify they pass.** Run `pnpm --filter mobile test -- offline-cache`. Expected: PASS (20 tests). If a `savedAtLabel` case is an hour off, the test didn't run with `TZ=America/Chicago`; use `pnpm --filter mobile test`, not `jest` directly.

- [ ] **Step 7: One way to store and read.** In the mobile block of `eslint.config.js`, add `{ name: "expo-sqlite", message: "Use appDatabase() from @/db/database." }` to the `no-restricted-imports` `paths`. Exempt `apps/mobile/src/db/database.ts` and `apps/mobile/test/native/**`. In `docs/standards.md`, add the rows:

| Concern                       | The one way                                                                                                                                                                                                                                                           | Enforced by                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Data kept on the phone        | `appDatabase()` from `@/db/database`. A schema change appends one statement to `MIGRATIONS`; shipped entries are never edited. Parameters are always an array, and every row read is parsed with a zod schema. A new table is added to `TABLES` in `test/app-data.ts` | lint bans `expo-sqlite` elsewhere, review |
| Server data shown on a screen | `useCachedRead(read)` (or `cachedRead`) with a `CacheKind` from `REUSE_MINUTES` in `@/cache/freshness`. A result with `savedAt` is always shown with `<SavedCopyNote>`                                                                                                | review                                    |

- [ ] **Step 8: Check and commit.** Run `pnpm check`, then:

```bash
git add apps/mobile eslint.config.js docs/standards.md pnpm-lock.yaml
git commit -m "feat(mobile): on-phone database and an offline cache that keeps the site's catch-up promises"
```

---

### Task 5: Launch: forced upgrade and Help now

`/config` is read at every launch. Below the platform's minimum version, Nearby and Online show the upgrade notice instead of searching, while Saved, Me and Help keep working from what's on the phone. Every screen's header has "Help", which opens the crisis lines.

**Files:**

- Create:
  - `apps/mobile/src/config/app-version.ts`, `apps/mobile/src/config/upgrade.tsx`
  - `apps/mobile/src/ui/button.tsx`, `apps/mobile/src/ui/help-resources.tsx`, `apps/mobile/src/ui/help-now-button.tsx`, `apps/mobile/src/ui/upgrade-notice.tsx`
  - `apps/mobile/src/app/help.tsx`
  - `apps/mobile/test/native/expo-application.ts`, `apps/mobile/test/launch.test.tsx`
- Modify:
  - `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/(tabs)/_layout.tsx`, `apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/app/(tabs)/online.tsx`
  - `apps/mobile/jest.config.js`, `apps/mobile/test/setup.ts`, `apps/mobile/package.json`

**Interfaces:**

- Consumes: `isOlderVersion` (Task 1), `fetchConfig` (Task 3), `useCachedRead` (Task 4).
- Produces:
  - `appVersion(): string` and `appPlatform(): Platform` from `@/config/app-version`;
  - `UpgradeProvider` and `useUpgradeRequired(): boolean` from `@/config/upgrade`;
  - `Button` from `@/ui/button`, with props `{ label: string; onPress: () => void; kind?: "primary" | "secondary"; hint?: string }` and at least 44 × 44 points;
  - `HelpResources` from `@/ui/help-resources`;
  - `HelpNowButton` from `@/ui/help-now-button`;
  - `UpgradeNotice` from `@/ui/upgrade-notice`;
  - the route `/help`;
  - test helper: `setAppVersion(version: string | null)` from `test/native/expo-application.ts`.

- [ ] **Step 1: Fake the installed version.** Run `pnpm --filter mobile exec expo install expo-application`. Create `apps/mobile/test/native/expo-application.ts`:

```ts
// The installed app's version, as expo-application reports it. Tests change it with setAppVersion.
export let nativeApplicationVersion: string | null = "0.1.0";

export function setAppVersion(version: string | null): void {
  nativeApplicationVersion = version;
}
```

Map `"^expo-application$": "<rootDir>/test/native/expo-application.ts"` in `jest.config.js`, and in `test/setup.ts` import `setAppVersion` and call `setAppVersion("0.1.0")` in a `beforeEach`.

- [ ] **Step 2: Write the failing tests.** Create `apps/mobile/test/launch.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

import { writeCache } from "@/cache/store";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { CONFIG } from "./fixtures";
import { setAppVersion } from "./native/expo-application";
import { renderApp } from "./render-app";

let api: TestApi;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});
afterEach(async () => {
  await api.close();
});

const tooOld = { ...CONFIG, minSupportedVersion: { ios: "0.2.0", android: "0.2.0" } };

describe("forced upgrade", () => {
  it("replaces searching with the upgrade notice below the minimum version", async () => {
    api.reply("/api/v1/config", tooOld);
    renderApp("/");
    expect(await screen.findByText("Please update mymeetingapp")).toBeOnTheScreen();
    expect(screen.queryByText("Search by city, zip code or address, or use your location.")).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Update the app" }));
    expect(Linking.openURL).toHaveBeenCalledWith("http://127.0.0.1:3197/");
  });

  it("keeps Saved and Me working while the upgrade is required", async () => {
    api.reply("/api/v1/config", tooOld);
    renderApp("/saved");
    expect(await screen.findByText("Meetings you save appear here.")).toBeOnTheScreen();
  });

  it("still requires the upgrade offline, from the last config the phone saw", async () => {
    await writeCache("config", tooOld);
    await api.close();
    renderApp("/online");
    expect(await screen.findByText("Please update mymeetingapp")).toBeOnTheScreen();
    api = await startApi();
  });

  it("lets a current version search, and doesn't block when the config can't be read", async () => {
    await api.close();
    renderApp("/");
    expect(
      await screen.findByText("Search by city, zip code or address, or use your location."),
    ).toBeOnTheScreen();
    api = await startApi();
  });

  it("compares the installed version", async () => {
    setAppVersion("0.2.0");
    api.reply("/api/v1/config", tooOld);
    renderApp("/");
    expect(
      await screen.findByText("Search by city, zip code or address, or use your location."),
    ).toBeOnTheScreen();
  });
});

describe("Help now", () => {
  it("is in every tab's header and opens the crisis lines", async () => {
    api.reply("/api/v1/config", CONFIG);
    renderApp("/me");
    fireEvent.press(await screen.findByRole("button", { name: "Help now: crisis lines" }));
    expect(await screen.findByText("988 Suicide & Crisis Lifeline")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Call 988" }));
    expect(Linking.openURL).toHaveBeenCalledWith("tel:988");
    fireEvent.press(screen.getByRole("button", { name: "Text 988" }));
    expect(Linking.openURL).toHaveBeenCalledWith("sms:988");
    fireEvent.press(screen.getByRole("button", { name: "Call SAMHSA" }));
    expect(Linking.openURL).toHaveBeenCalledWith("tel:18006624357");
  });

  it("is on the upgrade notice too", async () => {
    api.reply("/api/v1/config", tooOld);
    renderApp("/");
    expect(await screen.findByText("SAMHSA National Helpline")).toBeOnTheScreen();
  });

  it("has buttons at least 44 points tall", async () => {
    api.reply("/api/v1/config", CONFIG);
    renderApp("/help");
    expect(await screen.findByRole("button", { name: "Call 988" })).toHaveStyle({
      minHeight: 44,
      minWidth: 44,
    });
  });
});
```

- [ ] **Step 3: Run to verify they fail.** Run `pnpm --filter mobile test -- launch`. Expected: FAIL. There's no upgrade notice and no Help button.

- [ ] **Step 4: Implement.** Create `apps/mobile/src/config/app-version.ts`:

```ts
import { type Platform as ApiPlatform, SemVer } from "@mymeetingapp/shared";
import { nativeApplicationVersion } from "expo-application";
import { Platform } from "react-native";

// The installed version (app.config.ts `version`, baked into the native build).
export function appVersion(): string {
  const parsed = SemVer.safeParse(nativeApplicationVersion);
  if (!parsed.success) throw new Error("The app's native version isn't a version like 1.2.3");
  return parsed.data;
}

export function appPlatform(): ApiPlatform {
  return Platform.OS === "android" ? "android" : "ios";
}
```

Create `apps/mobile/src/config/upgrade.tsx`:

```tsx
import { AppConfigResponse, isOlderVersion } from "@mymeetingapp/shared";
import { createContext, type ReactNode, useContext } from "react";

import { fetchConfig } from "@/api/reads";
import { useCachedRead } from "@/cache/use-cached-read";
import { appPlatform, appVersion } from "@/config/app-version";

const UpgradeRequired = createContext(false);

const CONFIG_READ = { kind: "config", key: "config", schema: AppConfigResponse, fetch: fetchConfig } as const;

// Spec §8: /config is checked at launch. Below the minimum version the app stops searching but keeps what's on the
// phone usable. No config at all (offline on first launch) never blocks.
export function UpgradeProvider({ children }: { children: ReactNode }) {
  const { state } = useCachedRead(CONFIG_READ);
  const required =
    state.status === "ready" && isOlderVersion(appVersion(), state.data.minSupportedVersion[appPlatform()]);
  return <UpgradeRequired.Provider value={required}>{children}</UpgradeRequired.Provider>;
}

export function useUpgradeRequired(): boolean {
  return useContext(UpgradeRequired);
}
```

Create `apps/mobile/src/ui/button.tsx`:

```tsx
import { Pressable } from "react-native";

import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

interface ButtonProps {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary";
  hint?: string;
}

// Every tappable control is at least 44 × 44 points and names itself to VoiceOver and TalkBack.
export function Button({ label, onPress, kind = "primary", hint }: ButtonProps) {
  const colors = useColors();
  const primary = kind === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.accent,
        backgroundColor: primary ? colors.accent : "transparent",
        justifyContent: "center",
        alignItems: "center",
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <AppText variant="label" style={{ color: primary ? colors.accentText : colors.accent }}>
        {label}
      </AppText>
    </Pressable>
  );
}
```

Create `apps/mobile/src/ui/help-resources.tsx`:

```tsx
import { Linking, View } from "react-native";

import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";

// Spec §8: 988 and the SAMHSA National Helpline are always reachable, in the website's words
// (apps/web/src/components/help-resources.tsx).
const LINES = [
  {
    name: "988 Suicide & Crisis Lifeline",
    detail: "Call or text 988, any time.",
    actions: [
      { label: "Call 988", url: "tel:988" },
      { label: "Text 988", url: "sms:988" },
    ],
  },
  {
    name: "SAMHSA National Helpline",
    detail: "1-800-662-4357, free and confidential, 24 hours a day.",
    actions: [{ label: "Call SAMHSA", url: "tel:18006624357" }],
  },
] as const;

export function HelpResources() {
  return (
    <View style={{ gap: 16 }}>
      <AppText variant="heading" accessibilityRole="header">
        Need help now?
      </AppText>
      {LINES.map((line) => (
        <View key={line.name} style={{ gap: 8 }}>
          <AppText variant="label">{line.name}</AppText>
          <AppText>{line.detail}</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {line.actions.map((action) => (
              <Button
                key={action.label}
                label={action.label}
                onPress={() => void Linking.openURL(action.url)}
              />
            ))}
          </View>
        </View>
      ))}
      <AppText>Alcoholics Anonymous has its own meeting finder at aa.org.</AppText>
      <Button
        kind="secondary"
        label="Open aa.org's meeting finder"
        onPress={() => void Linking.openURL("https://www.aa.org/find-aa")}
      />
    </View>
  );
}
```

Create `apps/mobile/src/ui/help-now-button.tsx`:

```tsx
import { router } from "expo-router";
import { Pressable } from "react-native";

import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

export function HelpNowButton() {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Help now: crisis lines"
      onPress={() => {
        router.push("/help");
      }}
      style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 12, justifyContent: "center" }}
    >
      <AppText variant="label" style={{ color: colors.accent }}>
        Help
      </AppText>
    </Pressable>
  );
}
```

Create `apps/mobile/src/ui/upgrade-notice.tsx`:

```tsx
import { Linking } from "react-native";

import { serverUrl } from "@/config/server-url";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { HelpResources } from "@/ui/help-resources";
import { Screen } from "@/ui/screen";

// Until Phase 6 has store IDs, "Update the app" opens the website, whose store buttons lead to the listing.
export function UpgradeNotice() {
  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        Please update mymeetingapp
      </AppText>
      <AppText>
        This version is too old to find meetings. Your saved meetings, sobriety counter and help numbers still
        work.
      </AppText>
      <Button label="Update the app" onPress={() => void Linking.openURL(`${serverUrl()}/`)} />
      <HelpResources />
    </Screen>
  );
}
```

Create `apps/mobile/src/app/help.tsx`:

```tsx
import { HelpResources } from "@/ui/help-resources";
import { Screen } from "@/ui/screen";

export default function HelpScreen() {
  return (
    <Screen>
      <HelpResources />
    </Screen>
  );
}
```

In `src/app/_layout.tsx`, wrap the `Stack` in `<UpgradeProvider>` and add `<Stack.Screen name="help" options={{ presentation: "modal", title: "Help now" }} />`. In `src/app/(tabs)/_layout.tsx`, add `headerRight: () => <HelpNowButton />` to `screenOptions`. At the top of `NearbyScreen` and `OnlineScreen`, add `if (useUpgradeRequired()) return <UpgradeNotice />;`.

- [ ] **Step 5: Run to verify they pass.** Run `pnpm --filter mobile test`. Expected: PASS. The app-shell test still passes: with no config reply, the server answers 599, the read fails and nothing blocks.

- [ ] **Step 6: Check and commit.** Run `pnpm check`, then:

```bash
git add apps/mobile pnpm-lock.yaml
git commit -m "feat(mobile): forced upgrade from /config, and Help now on every screen"
```

---

### Task 6: Meeting times and the Online tab

Meeting days and times are listed in the meeting's own zone. The Online tab shows online and hybrid meetings happening now and starting in the next two hours, converted to the phone's local time (spec §8). This task also brings in the meeting card, the tag chips ("Welcoming 14") and the tag labels, which every list uses.

**Files:**

- Create:
  - `apps/mobile/src/meetings/schedule.ts`, `apps/mobile/src/meetings/online-now.ts`, `apps/mobile/src/meetings/vocabulary.tsx`
  - `apps/mobile/src/cache/use-refresh-on-focus.ts`
  - `apps/mobile/src/ui/tag-chips.tsx`, `apps/mobile/src/ui/meeting-card.tsx`, `apps/mobile/src/ui/online-now-list.tsx`
  - `apps/mobile/test/schedule.test.ts`, `apps/mobile/test/online-tab.test.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx` (adds `VocabularyProvider`), `apps/mobile/src/app/(tabs)/online.tsx`

**Interfaces:**

- Consumes: `useCachedRead`, `SavedCopyNote` (Task 4); `fetchOnlineMeetings`, `fetchVocabulary` (Task 3); `clockLabel` (Task 4).
- Produces:
  - from `@/meetings/schedule`:
    - `type Scheduled = Pick<MeetingSummary, "day" | "time" | "endTime"> & { timezone: string }`;
    - `interface Occurrence { date: CivilDate; start: Date }`, with `type CivilDate = { year: number; month: number; day: number }`;
    - `lastOccurrence(meeting: Scheduled, now: Date): Occurrence`;
    - `nextStart(meeting: Scheduled, now: Date): Date`;
    - `occurrenceEnd(meeting: Scheduled, occurrence: Occurrence): Date`;
    - `listedTime(time: string): string` ("19:00" gives "7:00 PM");
    - `WEEKDAYS: readonly string[]` (Sunday first), `WEEKDAYS_SHORT`.
  - `onlineNow(meetings: MeetingSummary[], now: Date): { happening: TimedMeeting[]; soon: TimedMeeting[] }` from `@/meetings/online-now`, where `TimedMeeting = { meeting: MeetingSummary; start: Date }`.
  - `VocabularyProvider` and `useVocabularyTags(): ReadonlyMap<string, VocabularyTag>` from `@/meetings/vocabulary`, where `VocabularyTag = VocabularyResponse["tags"][number]`.
  - `useRefreshOnFocus(refresh: () => void)` from `@/cache/use-refresh-on-focus`.
  - `<TagChips tags={TagCount[]} />`, `<MeetingCard meeting={MeetingSummary} when={string} distance?={string} />` and `<OnlineNowList />` from `@/ui/*`.

- [ ] **Step 1: Write the failing schedule tests.** The expected instants come from the rules in Decision 6, checked by hand against a calendar. 2026-11-01 and 2026-03-08 are the US daylight-saving changes, and 2026-10-05 is a Monday. Create `apps/mobile/test/schedule.test.ts`:

```ts
import { onlineNow } from "@/meetings/online-now";
import { lastOccurrence, listedTime, nextStart } from "@/meetings/schedule";

import { meeting } from "./fixtures";

const chicagoMonday7pm = { day: 1, time: "19:00", endTime: null, timezone: "America/Chicago" };
const iso = (date: Date) => date.toISOString();

describe("occurrences in the meeting's own zone", () => {
  it("finds the latest start at or before now, and the next one", () => {
    const now = new Date("2026-10-05T23:30:00Z"); // Monday 6:30 PM in Chicago
    expect(iso(lastOccurrence(chicagoMonday7pm, now).start)).toBe("2026-09-29T00:00:00.000Z");
    expect(iso(nextStart(chicagoMonday7pm, now))).toBe("2026-10-06T00:00:00.000Z");
  });

  it("takes the earlier instant for a time that happens twice when clocks fall back", () => {
    const meetingAt = { day: 0, time: "01:30", endTime: null, timezone: "America/New_York" };
    expect(iso(nextStart(meetingAt, new Date("2026-10-31T12:00:00Z")))).toBe("2026-11-01T05:30:00.000Z");
  });

  it("moves a time the clocks skip an hour later, as the server does", () => {
    const meetingAt = { day: 0, time: "02:30", endTime: null, timezone: "America/New_York" };
    expect(iso(nextStart(meetingAt, new Date("2026-03-07T12:00:00Z")))).toBe("2026-03-08T07:30:00.000Z");
  });

  it.each([
    ["00:00", "12:00 AM"],
    ["07:05", "7:05 AM"],
    ["12:30", "12:30 PM"],
    ["19:00", "7:00 PM"],
  ])("lists %s as %s", (time, label) => {
    expect(listedTime(time)).toBe(label);
  });
});

describe("onlineNow", () => {
  const online = (change: Parameters<typeof meeting>[0]) =>
    meeting({ attendance: "online", conferenceUrl: "https://zoom.us/j/1", ...change });

  it("counts a meeting that crosses midnight as happening after midnight", () => {
    const lateNight = online({ day: 0, time: "23:30", endTime: "00:30", timezone: "America/Los_Angeles" });
    expect(onlineNow([lateNight], new Date("2026-10-05T07:15:00Z")).happening).toHaveLength(1);
    expect(onlineNow([lateNight], new Date("2026-10-05T07:31:00Z")).happening).toHaveLength(0);
  });

  it("gives a meeting with no end time an hour", () => {
    const noon = online({ day: 1, time: "12:00", endTime: null });
    expect(onlineNow([noon], new Date("2026-10-05T17:59:00Z")).happening).toHaveLength(1);
    expect(onlineNow([noon], new Date("2026-10-05T18:00:00Z")).happening).toHaveLength(0);
  });

  it("lists meetings starting within two hours as soon", () => {
    const eight = online({ day: 1, time: "20:00", endTime: null });
    expect(onlineNow([eight], new Date("2026-10-05T23:00:00Z")).soon).toHaveLength(1);
    expect(onlineNow([eight], new Date("2026-10-05T22:59:00Z")).soon).toHaveLength(0);
  });

  it("leaves out a meeting with no time zone", () => {
    const unknown = online({ day: 1, time: "18:00", timezone: null });
    expect(onlineNow([unknown], new Date("2026-10-05T23:30:00Z"))).toEqual({ happening: [], soon: [] });
  });
});
```

- [ ] **Step 2: Run to verify they fail.** Run `pnpm --filter mobile test -- schedule`. Expected: FAIL. The modules don't exist.

- [ ] **Step 3: Implement the schedule.** Create `apps/mobile/src/meetings/schedule.ts`:

```ts
import type { MeetingSummary } from "@mymeetingapp/shared";

import { clockLabel } from "@/time/clock";

export type Scheduled = Pick<MeetingSummary, "day" | "time" | "endTime"> & { timezone: string };
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}
export interface Occurrence {
  date: CivilDate;
  start: Date;
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
export const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// A meeting with no end time counts as an hour long.
const DEFAULT_MINUTES = 60;

const formats = new Map<string, Intl.DateTimeFormat>();

function localParts(instant: Date, timeZone: string) {
  let format = formats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formats.set(timeZone, format);
  }
  const parts = format.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const l = localParts(instant, timeZone);
  return (Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second) - instant.getTime()) / 60_000;
}

const hourOf = (time: string) => Number(time.slice(0, 2));
const minuteOf = (time: string) => Number(time.slice(3, 5));

// The instant a local date and time happen in a zone. A time the clocks skip (spring forward) resolves an hour later,
// as Postgres does for the tagging window; a time that happens twice (fall back) is the earlier one.
function zonedInstant(date: CivilDate, time: string, timeZone: string): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hourOf(time), minuteOf(time));
  const firstOffset = offsetMinutes(new Date(guess), timeZone);
  const first = guess - firstOffset * 60_000;
  const secondOffset = offsetMinutes(new Date(first), timeZone);
  if (secondOffset === firstOffset) return new Date(first);
  const second = guess - secondOffset * 60_000;
  return new Date(offsetMinutes(new Date(second), timeZone) === secondOffset ? second : first);
}

function shiftDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

const weekdayOf = (date: CivilDate) => new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();

// The latest start at or before `now`, on the meeting's weekday in its own zone.
export function lastOccurrence(meeting: Scheduled, now: Date): Occurrence {
  const local = localParts(now, meeting.timezone);
  const today = { year: local.year, month: local.month, day: local.day };
  const date = shiftDays(today, -((weekdayOf(today) - meeting.day + 7) % 7));
  const start = zonedInstant(date, meeting.time, meeting.timezone);
  if (start.getTime() <= now.getTime()) return { date, start };
  const weekEarlier = shiftDays(date, -7);
  return { date: weekEarlier, start: zonedInstant(weekEarlier, meeting.time, meeting.timezone) };
}

export function nextStart(meeting: Scheduled, now: Date): Date {
  return zonedInstant(shiftDays(lastOccurrence(meeting, now).date, 7), meeting.time, meeting.timezone);
}

// An end time at or before the start time is on the next day (11:30 PM to 12:30 AM).
export function occurrenceEnd(meeting: Scheduled, occurrence: Occurrence): Date {
  if (meeting.endTime === null) return new Date(occurrence.start.getTime() + DEFAULT_MINUTES * 60_000);
  const date = meeting.endTime > meeting.time ? occurrence.date : shiftDays(occurrence.date, 1);
  return zonedInstant(date, meeting.endTime, meeting.timezone);
}

// A listed "HH:MM" as people read it.
export function listedTime(time: string): string {
  return clockLabel(hourOf(time), minuteOf(time));
}
```

Create `apps/mobile/src/meetings/online-now.ts`:

```ts
import type { MeetingSummary } from "@mymeetingapp/shared";

import { lastOccurrence, nextStart, occurrenceEnd } from "@/meetings/schedule";

export interface TimedMeeting {
  meeting: MeetingSummary;
  start: Date;
}

const SOON_MINUTES = 120;

const byStart = (a: TimedMeeting, b: TimedMeeting) =>
  a.start.getTime() - b.start.getTime() || a.meeting.name.localeCompare(b.meeting.name);

// Spec §8 "Online now": meetings in progress, plus those starting within two hours. A meeting without a time zone
// can't be placed in time, so it's left out.
export function onlineNow(
  meetings: MeetingSummary[],
  now: Date,
): { happening: TimedMeeting[]; soon: TimedMeeting[] } {
  const happening: TimedMeeting[] = [];
  const soon: TimedMeeting[] = [];
  for (const meeting of meetings) {
    if (meeting.timezone === null) continue;
    const scheduled = { ...meeting, timezone: meeting.timezone };
    const occurrence = lastOccurrence(scheduled, now);
    if (now.getTime() < occurrenceEnd(scheduled, occurrence).getTime()) {
      happening.push({ meeting, start: occurrence.start });
      continue;
    }
    const next = nextStart(scheduled, now);
    if (next.getTime() - now.getTime() <= SOON_MINUTES * 60_000) soon.push({ meeting, start: next });
  }
  return { happening: happening.sort(byStart), soon: soon.sort(byStart) };
}
```

- [ ] **Step 4: Run to verify they pass.** Run `pnpm --filter mobile test -- schedule`. Expected: PASS (11 tests).

- [ ] **Step 5: Write the failing Online tab tests.** Create `apps/mobile/test/online-tab.test.tsx`:

```tsx
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { AppState } from "react-native";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, VOCABULARY } from "./fixtures";
import { renderApp } from "./render-app";

let api: TestApi;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  setNow("2026-10-05T23:30:00Z"); // Monday 6:30 PM on the phone (America/Chicago)
});
afterEach(async () => {
  await api.close();
});

const online = (id: string, change: Parameters<typeof meeting>[0]) =>
  meeting({ id, attendance: "online", conferenceUrl: "https://zoom.us/j/1", locationName: null, ...change });

function replyDays(monday: ReturnType<typeof meeting>[]) {
  api.reply("/api/v1/meetings/online?day=0", { meetings: [] });
  api.reply("/api/v1/meetings/online?day=1", { meetings: monday });
  api.reply("/api/v1/meetings/online?day=2", { meetings: [] });
}

describe("the Online tab", () => {
  it("shows what's happening now and soon, in the phone's local time", async () => {
    replyDays([
      online("11111111-1111-4111-8111-111111111111", {
        name: "Early Evening",
        day: 1,
        time: "18:00",
        endTime: "19:00",
      }),
      online("22222222-2222-4222-8222-222222222222", {
        name: "East Coast Speakers",
        day: 1,
        time: "19:30",
        endTime: "20:30",
        timezone: "America/New_York",
      }),
      online("33333333-3333-4333-8333-333333333333", {
        name: "Night Owls",
        day: 1,
        time: "20:00",
        endTime: null,
      }),
      online("44444444-4444-4444-8444-444444444444", {
        name: "Late Book Study",
        day: 1,
        time: "21:00",
        endTime: null,
      }),
    ]);
    renderApp("/online");
    const now = within(await screen.findByLabelText("Happening now"));
    expect(now.getByRole("button", { name: /Early Evening, Started 6:00 PM/ })).toBeOnTheScreen();
    expect(now.getByRole("button", { name: /East Coast Speakers, Started 6:30 PM/ })).toBeOnTheScreen();
    const soon = within(screen.getByLabelText("Starting in the next 2 hours"));
    expect(soon.getByRole("button", { name: /Night Owls, Starts 8:00 PM/ })).toBeOnTheScreen();
    expect(screen.queryByText("Late Book Study")).toBeNull();
    expect(screen.getAllByLabelText("Welcoming, 14 people").length).toBeGreaterThan(0);
  });

  it("says so when nothing is on", async () => {
    replyDays([]);
    renderApp("/online");
    expect(await screen.findByText("No online meetings are happening right now.")).toBeOnTheScreen();
  });

  it("asks again each time the tab comes back into view", async () => {
    replyDays([]);
    renderApp("/online");
    await screen.findByText("No online meetings are happening right now.");
    const onlineRequests = () =>
      api.requests.filter((r) => r.path.startsWith("/api/v1/meetings/online")).length;
    expect(onlineRequests()).toBe(3);
    fireEvent.press(screen.getByLabelText("Me"));
    fireEvent.press(await screen.findByLabelText("Online"));
    await screen.findByText("No online meetings are happening right now.");
    expect(onlineRequests()).toBe(6);
  });

  it("reads the tag list again when the app returns to the foreground", async () => {
    const listeners: ((state: string) => void)[] = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
      listeners.push(listener);
      return { remove: () => undefined };
    });
    replyDays([]);
    renderApp("/online");
    await screen.findByText("No online meetings are happening right now.");
    act(() => {
      for (const listener of listeners) listener("active");
    });
    const vocabularyRequests = () => api.requests.filter((r) => r.path === "/api/v1/vocabulary").length;
    await screen.findByText("No online meetings are happening right now.");
    expect(vocabularyRequests()).toBe(2);
  });
});
```

(The New York meeting at 7:30 PM Eastern is 6:30 PM on the phone.)

- [ ] **Step 6: Run to verify they fail.** Run `pnpm --filter mobile test -- online-tab`. Expected: FAIL. The Online tab still shows its empty-state sentence.

- [ ] **Step 7: Implement the tag labels, chips, card and list.** Create `apps/mobile/src/meetings/vocabulary.tsx`:

```tsx
import { VocabularyResponse } from "@mymeetingapp/shared";
import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { AppState } from "react-native";

import { fetchVocabulary } from "@/api/reads";
import { useCachedRead } from "@/cache/use-cached-read";

export type VocabularyTag = VocabularyResponse["tags"][number];

const VOCABULARY_READ = {
  kind: "vocabulary",
  key: "vocabulary",
  schema: VocabularyResponse,
  fetch: fetchVocabulary,
} as const;

const Tags = createContext<ReadonlyMap<string, VocabularyTag>>(new Map());

// The tag labels every chip needs. Its reuse window is 0 (decision 3), so it's read at launch and again each time the
// app comes back to the foreground, and a retired or new tag reaches the app within the promised 25 hours.
export function VocabularyProvider({ children }: { children: ReactNode }) {
  const { state, refresh } = useCachedRead(VOCABULARY_READ);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => {
      subscription.remove();
    };
  }, [refresh]);
  const tags = useMemo(
    () => new Map(state.status === "ready" ? state.data.tags.map((tag) => [tag.slug, tag] as const) : []),
    [state],
  );
  return <Tags.Provider value={tags}>{children}</Tags.Provider>;
}

export function useVocabularyTags(): ReadonlyMap<string, VocabularyTag> {
  return useContext(Tags);
}
```

Create `apps/mobile/src/ui/tag-chips.tsx`:

```tsx
import type { TagCount } from "@mymeetingapp/shared";
import { View } from "react-native";

import { useVocabularyTags } from "@/meetings/vocabulary";
import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

// Spec §5: a flat list with counts, in the server's order. A slug the phone has no label for (a tag added since the
// list was last read) waits for the next read rather than showing a raw slug.
export function TagChips({ tags }: { tags: readonly TagCount[] }) {
  const colors = useColors();
  const labels = useVocabularyTags();
  const shown = tags.flatMap((tag) => {
    const label = labels.get(tag.slug)?.label;
    return label === undefined ? [] : [{ ...tag, label }];
  });
  if (shown.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {shown.map((tag) => (
        <View
          key={tag.slug}
          accessible
          accessibilityLabel={`${tag.label}, ${String(tag.count)} ${tag.count === 1 ? "person" : "people"}`}
          style={{
            backgroundColor: colors.tagBg,
            borderRadius: 999,
            paddingHorizontal: 12,
            paddingVertical: 4,
          }}
        >
          <AppText variant="small">
            {`${tag.label} `}
            <AppText variant="small" style={{ fontWeight: "700" }}>
              {String(tag.count)}
            </AppText>
          </AppText>
        </View>
      ))}
    </View>
  );
}
```

Create `apps/mobile/src/ui/meeting-card.tsx`:

```tsx
import type { MeetingSummary } from "@mymeetingapp/shared";
import { router } from "expo-router";
import { Pressable } from "react-native";

import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";
import { TagChips } from "@/ui/tag-chips";

// A card in any meeting list: name, when (and how far), place, and the top three tags.
export function MeetingCard({
  meeting,
  when,
  distance,
}: {
  meeting: MeetingSummary;
  when: string;
  distance?: string;
}) {
  const colors = useColors();
  const meta = distance === undefined ? when : `${when} · ${distance}`;
  const spoken = [meeting.name, when, distance, meeting.locationName]
    .filter((part) => part != null)
    .join(", ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint="Opens the meeting's details"
      onPress={() => {
        router.push(`/meeting/${meeting.id}`);
      }}
      style={{
        minHeight: 44,
        padding: 16,
        gap: 6,
        backgroundColor: colors.surface,
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: 12,
      }}
    >
      <AppText variant="label">{meeting.name}</AppText>
      <AppText tone="muted">{meta}</AppText>
      {meeting.locationName !== null && <AppText tone="muted">{meeting.locationName}</AppText>}
      <TagChips tags={meeting.tags.slice(0, 3)} />
    </Pressable>
  );
}
```

Create `apps/mobile/src/cache/use-refresh-on-focus.ts`:

```ts
import { useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

// Reads again each time the screen comes back into view. The first focus is the mount, which has already read.
export function useRefreshOnFocus(refresh: () => void): void {
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      refresh();
    }, [refresh]),
  );
}
```

Create `apps/mobile/src/ui/online-now-list.tsx`:

```tsx
import { OnlineMeetingsResponse } from "@mymeetingapp/shared";
import { useCallback } from "react";
import { ActivityIndicator, View } from "react-native";

import { fetchOnlineMeetings } from "@/api/reads";
import { useCachedRead } from "@/cache/use-cached-read";
import { useRefreshOnFocus } from "@/cache/use-refresh-on-focus";
import { onlineNow, type TimedMeeting } from "@/meetings/online-now";
import { clockLabel } from "@/time/clock";
import { AppText } from "@/ui/app-text";
import { MeetingCard } from "@/ui/meeting-card";
import { SavedCopyNote } from "@/ui/saved-copy-note";

const onlineRead = (day: number) =>
  ({
    kind: "onlineMeetings",
    key: `online:${String(day)}`,
    schema: OnlineMeetingsResponse,
    fetch: () => fetchOnlineMeetings(day),
  }) as const;

const local = (start: Date) => clockLabel(start.getHours(), start.getMinutes());

function Section({
  title,
  items,
  verb,
}: {
  title: string;
  items: TimedMeeting[];
  verb: "Started" | "Starts";
}) {
  if (items.length === 0) return null;
  return (
    <View accessibilityLabel={title} style={{ gap: 12 }}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      {items.map(({ meeting, start }) => (
        <MeetingCard key={meeting.id} meeting={meeting} when={`${verb} ${local(start)}`} />
      ))}
    </View>
  );
}

// A meeting's own weekday can differ from the phone's by one, so it reads the phone's yesterday, today and tomorrow.
export function OnlineNowList() {
  const today = new Date().getDay();
  const yesterday = useCachedRead(onlineRead((today + 6) % 7));
  const current = useCachedRead(onlineRead(today));
  const tomorrow = useCachedRead(onlineRead((today + 1) % 7));
  const reads = [yesterday, current, tomorrow];
  const refreshAll = useCallback(() => {
    yesterday.refresh();
    current.refresh();
    tomorrow.refresh();
  }, [yesterday.refresh, current.refresh, tomorrow.refresh]);
  useRefreshOnFocus(refreshAll);

  if (reads.some((read) => read.state.status === "loading")) {
    return <ActivityIndicator accessibilityLabel="Loading online meetings" />;
  }
  const failed = reads.find((read) => read.state.status === "failed")?.state;
  const ready = reads.flatMap((read) => (read.state.status === "ready" ? [read.state] : []));
  const savedAt = ready
    .flatMap((state) => (state.savedAt === null ? [] : [state.savedAt]))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const { happening, soon } = onlineNow(
    ready.flatMap((state) => state.data.meetings),
    new Date(),
  );
  return (
    <View style={{ gap: 20 }}>
      {failed?.status === "failed" && <AppText>{failed.message}</AppText>}
      {savedAt !== undefined && <SavedCopyNote savedAt={savedAt} />}
      {happening.length === 0 && soon.length === 0 && failed === undefined && (
        <AppText>No online meetings are happening right now.</AppText>
      )}
      <Section title="Happening now" items={happening} verb="Started" />
      <Section title="Starting in the next 2 hours" items={soon} verb="Starts" />
    </View>
  );
}
```

Replace `apps/mobile/src/app/(tabs)/online.tsx`:

```tsx
import { useUpgradeRequired } from "@/config/upgrade";
import { OnlineNowList } from "@/ui/online-now-list";
import { Screen } from "@/ui/screen";
import { UpgradeNotice } from "@/ui/upgrade-notice";

export default function OnlineScreen() {
  if (useUpgradeRequired()) return <UpgradeNotice />;
  return (
    <Screen>
      <OnlineNowList />
    </Screen>
  );
}
```

In `src/app/_layout.tsx`, wrap the providers as `<UpgradeProvider><VocabularyProvider>…</VocabularyProvider></UpgradeProvider>`. Task 5's `launch.test.tsx` needs no change: nothing in it reads the Online tab's old empty-state sentence.

- [ ] **Step 8: Run to verify they pass.** Run `pnpm --filter mobile test`. Expected: PASS. The card `accessibilityLabel` reads "Early Evening, Started 6:00 PM" (the location is null), which the `/Early Evening, Started 6:00 PM/` pattern matches. The `react-hooks/exhaustive-deps` rule accepts `refreshAll`'s dependencies, because each `refresh` is stable (`useCallback` with no dependencies).

- [ ] **Step 9: Check and commit.** Run `pnpm check`, then:

```bash
git add apps/mobile
git commit -m "feat(mobile): Online tab with meetings happening now in local time, tag chips and meeting cards"
```

---

### Task 7: Location, place lookup and recent places

This task adds the location building blocks Nearby and the map use:

- rounding to 2 decimals on the phone;
- exact distance;
- the map's search radius;
- location permission asked only on a tap;
- the platform geocoder, through the local module `modules/native-location` (Owner decision 1);
- recent places, kept on the phone.

**Files:**

- Create:
  - `apps/mobile/src/location/geo.ts`, `current-position.ts`, `find-place.ts`, `recent-places.ts`
  - `apps/mobile/modules/native-location/` (`expo-module.config.json`, `index.ts`, `ios/NativeLocationModule.swift`, `android/src/main/java/expo/modules/nativelocation/NativeLocationModule.kt`, plus the podspec and `android/build.gradle` generated by `create-expo-module`)
  - `apps/mobile/test/native/expo-location.ts`, `apps/mobile/test/native/native-location.ts`, `apps/mobile/test/location.test.ts`
- Modify:
  - `apps/mobile/src/db/migrations.ts`, `apps/mobile/app.config.ts`, `apps/mobile/jest.config.js`
  - `apps/mobile/test/setup.ts`, `apps/mobile/test/app-data.ts`, `apps/mobile/test/app-shell.test.tsx`
  - `apps/mobile/package.json`, `eslint.config.js`, `docs/standards.md`

**Interfaces:**

- Produces:
  - from `@/location/geo`:
    - `interface LatLng { latitude: number; longitude: number }`;
    - `interface MapRegion extends LatLng { latitudeDelta: number; longitudeDelta: number }`;
    - `SEARCH_RADIUS_KM = 25`;
    - `roundForSearch(point: LatLng): LatLng`;
    - `distanceKm(a: LatLng, b: LatLng): number`;
    - `radiusForRegion(region: MapRegion): number`;
  - from `@/location/current-position`: `currentPosition(): Promise<PositionResult>`, where `PositionResult = { status: "found"; point: LatLng } | { status: "denied" } | { status: "unavailable" }`, and `locationAlreadyAllowed(): Promise<boolean>`;
  - `findPlace(text: string): Promise<LatLng | null>` from `@/location/find-place`;
  - from `@/location/recent-places`: `rememberPlace(label: string, point: LatLng)`, `recentPlaces(): Promise<RecentPlace[]>` (newest first, at most 10), `forgetRecentPlaces()`, with `RecentPlace = LatLng & { label: string }`;
  - test helpers: `setPermissionAnswer`, `setLocationPermission`, `setDevicePosition`, `permissionRequests()` and `resetLocation` from `test/native/expo-location.ts`; `setPlace`, `lookups` and `resetPlaces` from `test/native/native-location.ts`.

- [ ] **Step 1: Create the native module.** From `apps/mobile`, run `npx create-expo-module@latest --local native-location` (name `native-location`, native module name `NativeLocation`, package `expo.modules.nativelocation`). Delete everything it generated except `expo-module.config.json`, `ios/*.podspec` and `android/build.gradle`. That removes the example view, the web file, the `src/` folder and the example Swift and Kotlin. Then write:

`apps/mobile/modules/native-location/expo-module.config.json`:

```json
{
  "platforms": ["apple", "android"],
  "apple": { "modules": ["NativeLocationModule"] },
  "android": { "modules": ["expo.modules.nativelocation.NativeLocationModule"] }
}
```

`apps/mobile/modules/native-location/index.ts`:

```ts
import { requireNativeModule } from "expo";

// The answer is checked in JavaScript (src/location/find-place.ts), so it's typed as unknown here.
interface NativeLocationModule {
  findPlace(text: string): Promise<unknown>;
}

export default requireNativeModule<NativeLocationModule>("NativeLocation");
```

`apps/mobile/modules/native-location/ios/NativeLocationModule.swift`:

```swift
import CoreLocation
import ExpoModulesCore

// Spec §8: a place someone types becomes a point through Apple's geocoder, on the phone, with no location permission.
// Our server never sees the text. (CLGeocoder is deprecated from iOS 26 in favour of MapKit's geocoding request; it
// still works on every iOS Expo SDK 57 supports.)
public class NativeLocationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NativeLocation")

    AsyncFunction("findPlace") { (text: String) async -> [String: Double]? in
      // CLGeocoder reports "no match" as an error; either way the answer is "not found".
      guard let placemarks = try? await CLGeocoder().geocodeAddressString(text),
            let coordinate = placemarks.first?.location?.coordinate else { return nil }
      return ["latitude": coordinate.latitude, "longitude": coordinate.longitude]
    }
  }
}
```

`apps/mobile/modules/native-location/android/src/main/java/expo/modules/nativelocation/NativeLocationModule.kt`:

```kotlin
package expo.modules.nativelocation

import android.location.Address
import android.location.Geocoder
import android.os.Build
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext

// Spec §8: Android's own Geocoder needs no location permission (expo-location's wrapper insists on one), so a fresh
// install with no permission can still search by place. Our server never sees the text.
class NativeLocationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NativeLocation")

    AsyncFunction("findPlace") Coroutine { text: String ->
      val context = appContext.reactContext ?: return@Coroutine null
      if (!Geocoder.isPresent()) return@Coroutine null
      val address = firstAddress(Geocoder(context, Locale.US), text) ?: return@Coroutine null
      mapOf("latitude" to address.latitude, "longitude" to address.longitude)
    }
  }

  private suspend fun firstAddress(geocoder: Geocoder, text: String): Address? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      suspendCancellableCoroutine { continuation ->
        geocoder.getFromLocationName(text, 1, object : Geocoder.GeocodeListener {
          override fun onGeocode(addresses: MutableList<Address>) {
            continuation.resume(addresses.firstOrNull())
          }

          override fun onError(errorMessage: String?) {
            continuation.resume(null)
          }
        })
      }
    } else {
      withContext(Dispatchers.IO) {
        @Suppress("DEPRECATION")
        runCatching { geocoder.getFromLocationName(text, 1) }.getOrNull()?.firstOrNull()
      }
    }
}
```

Native code can't run under Jest. Task 14's smoke test checks it on a device ("a fresh install finds Maryville, TN with location off").

- [ ] **Step 2: Fake the location packages.** Run `pnpm --filter mobile exec expo install expo-location`. Create `apps/mobile/test/native/expo-location.ts`:

```ts
type Status = "granted" | "denied" | "undetermined";

let status: Status = "undetermined";
// What the person taps when the permission dialog appears.
let answer: "granted" | "denied" = "granted";
let position: { latitude: number; longitude: number } | "fails" = {
  latitude: 36.162749,
  longitude: -86.781602,
};
let requests = 0;

export const Accuracy = { Balanced: 3 } as const;

export function setPermissionAnswer(next: "granted" | "denied"): void {
  answer = next;
}
export function setLocationPermission(next: Status): void {
  status = next;
}
export function setDevicePosition(next: typeof position): void {
  position = next;
}
export function permissionRequests(): number {
  return requests;
}
export function resetLocation(): void {
  status = "undetermined";
  answer = "granted";
  position = { latitude: 36.162749, longitude: -86.781602 };
  requests = 0;
}

const response = () => ({ status, granted: status === "granted", canAskAgain: true, expires: "never" });

export function getForegroundPermissionsAsync() {
  return Promise.resolve(response());
}

export function requestForegroundPermissionsAsync() {
  requests += 1;
  if (status === "undetermined") status = answer;
  return Promise.resolve(response());
}

export function getCurrentPositionAsync() {
  if (position === "fails") return Promise.reject(new Error("Location unavailable"));
  return Promise.resolve({ coords: { ...position, accuracy: 20 }, timestamp: Date.now() });
}
```

Create `apps/mobile/test/native/native-location.ts`:

```ts
const places = new Map<string, unknown>();
export const lookups: string[] = [];

export function setPlace(text: string, answer: unknown): void {
  places.set(text, answer);
}

export function resetPlaces(): void {
  places.clear();
  lookups.length = 0;
}

export default {
  findPlace(text: string): Promise<unknown> {
    lookups.push(text);
    return Promise.resolve(places.get(text) ?? null);
  },
};
```

In `jest.config.js`, map `"^expo-location$": "<rootDir>/test/native/expo-location.ts"` and `"^@modules/native-location$": "<rootDir>/test/native/native-location.ts"`, both above `"^@/(.*)$"`. Add `"^@modules/(.*)$": "<rootDir>/modules/$1"` after them. In `test/setup.ts`, call `resetLocation()` and `resetPlaces()` in the `beforeEach`.

- [ ] **Step 3: Write the failing tests.** Create `apps/mobile/test/location.test.ts`:

```ts
import { MeetingSearchRequest } from "@mymeetingapp/shared";

import { currentPosition, locationAlreadyAllowed } from "@/location/current-position";
import { findPlace } from "@/location/find-place";
import { distanceKm, radiusForRegion, roundForSearch } from "@/location/geo";
import { forgetRecentPlaces, recentPlaces, rememberPlace } from "@/location/recent-places";

import { resetAppData } from "./app-data";
import {
  permissionRequests,
  setDevicePosition,
  setLocationPermission,
  setPermissionAnswer,
} from "./native/expo-location";
import { lookups, setPlace } from "./native/native-location";

beforeEach(async () => {
  await resetAppData();
});

describe("roundForSearch", () => {
  it("rounds to 2 decimal places, about 1 km", () => {
    expect(roundForSearch({ latitude: 36.162749, longitude: -86.781602 })).toEqual({
      latitude: 36.16,
      longitude: -86.78,
    });
  });

  it.each([36.162749, -86.781602, 1.005, 2.675, 45.125, 89.999, -179.996, 0.004])(
    "always gives a point the server accepts (%s)",
    (value) => {
      const point = roundForSearch({ latitude: Math.max(-90, Math.min(90, value)), longitude: value });
      expect(
        MeetingSearchRequest.safeParse({ lat: point.latitude, lng: point.longitude, radiusKm: 25 }).success,
      ).toBe(true);
    },
  );
});

describe("distanceKm", () => {
  it("measures great-circle distance", () => {
    expect(
      distanceKm({ latitude: 36.1627, longitude: -86.7816 }, { latitude: 35.9606, longitude: -83.9207 }),
    ).toBeCloseTo(258.13, 1);
    expect(
      distanceKm({ latitude: 36.1627, longitude: -86.7816 }, { latitude: 36.1627, longitude: -86.7816 }),
    ).toBe(0);
  });
});

describe("radiusForRegion", () => {
  it.each([
    [{ latitude: 36.16, longitude: -86.78, latitudeDelta: 0.2, longitudeDelta: 0.3 }, 18],
    [{ latitude: 36.16, longitude: -86.78, latitudeDelta: 2, longitudeDelta: 3 }, 100],
    [{ latitude: 36.16, longitude: -86.78, latitudeDelta: 0.001, longitudeDelta: 0.001 }, 1],
  ])("covers the visible map within the API's 1–100 km (%j gives %d)", (region, radius) => {
    expect(radiusForRegion(region)).toBe(radius);
  });
});

describe("currentPosition", () => {
  it("asks for permission, then gives the exact point, which stays on the phone", async () => {
    expect(await currentPosition()).toEqual({
      status: "found",
      point: { latitude: 36.162749, longitude: -86.781602 },
    });
    expect(permissionRequests()).toBe(1);
  });

  it("reports a refusal", async () => {
    setPermissionAnswer("denied");
    expect(await currentPosition()).toEqual({ status: "denied" });
  });

  it("reports a phone that can't find itself", async () => {
    setDevicePosition("fails");
    expect(await currentPosition()).toEqual({ status: "unavailable" });
  });

  it("checks an earlier grant without asking", async () => {
    expect(await locationAlreadyAllowed()).toBe(false);
    setLocationPermission("granted");
    expect(await locationAlreadyAllowed()).toBe(true);
    expect(permissionRequests()).toBe(0);
  });
});

describe("findPlace", () => {
  it("asks the platform geocoder for the trimmed text", async () => {
    setPlace("Maryville, TN", { latitude: 35.7565, longitude: -83.9705 });
    expect(await findPlace("  Maryville, TN ")).toEqual({ latitude: 35.7565, longitude: -83.9705 });
    expect(lookups).toEqual(["Maryville, TN"]);
  });

  it("finds nothing for blank text without asking the geocoder", async () => {
    expect(await findPlace("   ")).toBeNull();
    expect(lookups).toEqual([]);
  });

  it("passes on the geocoder's 'not found'", async () => {
    expect(await findPlace("Nowhere at all")).toBeNull();
  });

  it("treats an answer off the globe as a bug, not a place", async () => {
    setPlace("Broken", { latitude: 200, longitude: 0 });
    await expect(findPlace("Broken")).rejects.toThrow();
  });
});

describe("recent places", () => {
  it("keeps the 10 newest, newest first, ignoring case for repeats", async () => {
    for (let i = 1; i <= 11; i++) await rememberPlace(`Place ${String(i)}`, { latitude: 36, longitude: -86 });
    await rememberPlace("place 3", { latitude: 36, longitude: -86 });
    const labels = (await recentPlaces()).map((place) => place.label);
    expect(labels).toEqual([
      "place 3",
      "Place 11",
      "Place 10",
      "Place 9",
      "Place 8",
      "Place 7",
      "Place 6",
      "Place 5",
      "Place 4",
      "Place 2",
    ]);
  });

  it("forgets them all on request", async () => {
    await rememberPlace("Maryville, TN", { latitude: 35.7565, longitude: -83.9705 });
    await forgetRecentPlaces();
    expect(await recentPlaces()).toEqual([]);
  });
});
```

(The 18 km case: half the region's height is 0.1 × 111.32 = 11.1 km and half its width 0.15 × 111.32 × cos 36.16° = 13.5 km, so the diagonal is 17.5 km, rounded up to 18.)

- [ ] **Step 4: Run to verify they fail.** Run `pnpm --filter mobile test -- location`. Expected: FAIL. The modules don't exist.

- [ ] **Step 5: Implement.** Create `apps/mobile/src/location/geo.ts`:

```ts
export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface MapRegion extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

// Searches from the search box or "Use my location" (decision 7): 25 km, about 16 miles.
export const SEARCH_RADIUS_KM = 25;

const KM_PER_DEGREE = 111.32;
const EARTH_RADIUS_KM = 6371.0088;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

// Spec §2: the phone rounds to 2 decimal places (about 1 km) before anything leaves it. The server refuses anything
// finer (MeetingSearchRequest).
export function roundForSearch(point: LatLng): LatLng {
  return {
    latitude: Math.round(point.latitude * 100) / 100,
    longitude: Math.round(point.longitude * 100) / 100,
  };
}

// Spec §8: the phone re-sorts by exact distance from the real point, which never leaves it.
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

// Spec §8 "radius from the visible area": half the map's diagonal, in whole km, within the API's 1–100.
export function radiusForRegion(region: MapRegion): number {
  const halfHeight = (region.latitudeDelta / 2) * KM_PER_DEGREE;
  const halfWidth = (region.longitudeDelta / 2) * KM_PER_DEGREE * Math.cos(toRadians(region.latitude));
  return Math.min(100, Math.max(1, Math.ceil(Math.hypot(halfHeight, halfWidth))));
}
```

Create `apps/mobile/src/location/current-position.ts`:

```ts
import * as Location from "expo-location";

import type { LatLng } from "@/location/geo";

export type PositionResult =
  { status: "found"; point: LatLng } | { status: "denied" } | { status: "unavailable" };

// Spec §2: While Using permission, asked only when the person taps "Use my location": never at launch, never in the
// background. The exact point stays on the phone; only roundForSearch's rounding of it is ever sent.
export async function currentPosition(): Promise<PositionResult> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") return { status: "denied" };
  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return {
      status: "found",
      point: { latitude: position.coords.latitude, longitude: position.coords.longitude },
    };
  } catch {
    return { status: "unavailable" };
  }
}

// Permission granted on an earlier tap: Nearby may start near the person without asking again (decision 10).
export async function locationAlreadyAllowed(): Promise<boolean> {
  return (await Location.getForegroundPermissionsAsync()).status === "granted";
}
```

Create `apps/mobile/src/location/find-place.ts`:

```ts
import NativeLocation from "@modules/native-location";
import { z } from "zod";

import type { LatLng } from "@/location/geo";

const Answer = z
  .object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) })
  .nullable();

// Spec §8: the platform geocoder (Apple's CLGeocoder, Android's Geocoder) turns the text into a point on the phone.
// Our server never receives the text, only the rounded point. An answer off the globe is a native bug and throws.
export async function findPlace(text: string): Promise<LatLng | null> {
  const query = text.trim();
  if (query.length === 0) return null;
  return Answer.parse(await NativeLocation.findPlace(query));
}
```

Append to `MIGRATIONS` in `apps/mobile/src/db/migrations.ts`:

```ts
  // Spec §8: recent searched places, on the phone only.
  `create table recent_places (label text primary key collate nocase, latitude real not null, longitude real not null, used_at integer not null) strict;`,
```

and add `"recent_places"` to `TABLES` in `test/app-data.ts`.

Create `apps/mobile/src/location/recent-places.ts`:

```ts
import { z } from "zod";

import { appDatabase } from "@/db/database";
import type { LatLng } from "@/location/geo";

export type RecentPlace = LatLng & { label: string };

const KEEP = 10;
const Row = z.object({ label: z.string(), latitude: z.number(), longitude: z.number() });

export async function rememberPlace(label: string, point: LatLng): Promise<void> {
  const db = await appDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync("delete from recent_places where label = ?", [label]);
    await db.runAsync("insert into recent_places (label, latitude, longitude, used_at) values (?, ?, ?, ?)", [
      label,
      point.latitude,
      point.longitude,
      Date.now(),
    ]);
    await db.runAsync(
      "delete from recent_places where rowid not in (select rowid from recent_places order by used_at desc, rowid desc limit ?)",
      [KEEP],
    );
  });
}

export async function recentPlaces(): Promise<RecentPlace[]> {
  const db = await appDatabase();
  const rows = await db.getAllAsync(
    "select label, latitude, longitude from recent_places order by used_at desc, rowid desc",
    [],
  );
  return z.array(Row).parse(rows);
}

export async function forgetRecentPlaces(): Promise<void> {
  const db = await appDatabase();
  await db.runAsync("delete from recent_places", []);
}
```

(Deleting a repeat by label, case-insensitively through `collate nocase`, then inserting keeps the newest spelling: "place 3" replaces "Place 3".)

In `apps/mobile/app.config.ts`, add to `plugins`:

```ts
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "mymeetingapp uses your location to sort nearby meetings. It rounds it to about 1 km before searching, and your exact location never leaves your phone.",
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        motionUsagePermission: false,
      },
    ],
```

and to `android`:

```ts
    permissions: ["android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"],
    blockedPermissions: ["android.permission.ACCESS_BACKGROUND_LOCATION"],
```

Extend `test/app-shell.test.tsx`'s config test (spec §11): `Config` gains `android.permissions: z.array(z.string())` and `android.blockedPermissions: z.array(z.string())`. Add expectations that `permissions` equals the two foreground permissions, that `blockedPermissions` contains `android.permission.ACCESS_BACKGROUND_LOCATION`, and that `JSON.stringify(appConfig({ config: {} }))` contains `"locationAlwaysPermission":false`.

- [ ] **Step 6: Run to verify they pass.** Run `pnpm --filter mobile test`. Expected: PASS.

- [ ] **Step 7: One way to reach location.** In the mobile ESLint block, add `{ name: "expo-location", message: "Use @/location/current-position." }` to `paths`, exempting `apps/mobile/src/location/**` and `apps/mobile/test/native/**`. In `docs/standards.md`, add:

| Concern                        | The one way                                                                                                                                                                                                                                                                                                          | Enforced by                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Location and places in the app | `currentPosition()` (asks only on a tap), `locationAlreadyAllowed()`, `findPlace(text)` (the platform geocoder through `@modules/native-location`) and `roundForSearch(point)` before anything is sent. Exact points and search text never leave `src/location` and the screen that holds them, and are never logged | lint bans `expo-location` elsewhere, review |

- [ ] **Step 8: Check and commit.** Run `pnpm check`, then:

```bash
git add apps/mobile eslint.config.js docs/standards.md pnpm-lock.yaml
git commit -m "feat(mobile): rounding, exact distance, on-tap location, platform place lookup and recent places"
```

---

### Task 8: The Nearby list, filters and the online fallback

This is the main screen. A fresh install shows a search box and "Use my location", and asks for nothing at launch. A search by place asks the phone's geocoder, sends only the rounded point, and re-sorts the answer by exact distance on the phone. Filter pills narrow the list on the phone. With no in-person meetings, the screen says so plainly and shows the online meetings instead (spec §8).

**Files:**

- Create:
  - `apps/mobile/src/search/nearby.ts`, `apps/mobile/src/search/filters.tsx`
  - `apps/mobile/src/meetings/type-labels.ts`, `apps/mobile/src/meetings/units.ts`
  - `apps/mobile/src/ui/pill.tsx`, `apps/mobile/src/ui/place-search.tsx`
  - `apps/mobile/src/app/filters.tsx`
  - `apps/mobile/test/filters.test.ts`, `apps/mobile/test/nearby.test.tsx`
- Modify: `apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/app/_layout.tsx` (adds `FiltersProvider` and the `filters` modal route)

**Interfaces:**

- Consumes: Task 7's location functions, `searchMeetings` (Task 3), `useCachedRead` and `SavedCopyNote` (Task 4), `MeetingCard`, `OnlineNowList`, `WEEKDAYS`, `WEEKDAYS_SHORT`, `listedTime` and `useVocabularyTags` (Task 6).
- Produces:
  - from `@/search/nearby`:
    - `interface SearchOrigin { kind: "me" | "place" | "map"; label: string; point: LatLng; radiusKm: number }`;
    - `type NearbyMeeting = MeetingSearchResponse["meetings"][number] & { exactKm: number }`;
    - `searchRead(origin: SearchOrigin): CachedRead<typeof MeetingSearchResponse>`;
    - `byExactDistance(meetings: MeetingSearchResponse["meetings"], from: LatLng): NearbyMeeting[]`;
  - from `@/search/filters`:
    - `interface MeetingFilters { days: number[]; times: TimeOfDay[]; types: MeetingTypeCode[]; tags: string[] }`;
    - `NO_FILTERS`, `TIMES_OF_DAY`, `TIME_ORDER`, `type TimeOfDay`;
    - `matchesFilters(meeting: MeetingSummary, filters: MeetingFilters): boolean`;
    - `toggled<T>(list: readonly T[], value: T): T[]`;
    - `FiltersProvider` and `useFilters(): { filters: MeetingFilters; setFilters(next: MeetingFilters): void }`;
  - `type MeetingTypeCode`, `TYPE_LABELS: Record<MeetingTypeCode, string>` and `FILTER_TYPES: readonly MeetingTypeCode[]` from `@/meetings/type-labels`;
  - `milesLabel(km: number): string` and `radiusMiles(km: number): number` from `@/meetings/units`;
  - `<Pill label selected onPress role? />` from `@/ui/pill`;
  - `<PlaceSearch onPlace={(text: string) => void} onRecent={(place: RecentPlace) => void} onNearMe={() => void} />` from `@/ui/place-search`;
  - the route `/filters`.

- [ ] **Step 1: Write the failing pure tests.** Create `apps/mobile/test/filters.test.ts`:

```ts
import { milesLabel } from "@/meetings/units";
import { matchesFilters, NO_FILTERS } from "@/search/filters";
import { byExactDistance } from "@/search/nearby";

import { meeting, nearbyMeeting } from "./fixtures";

describe("matchesFilters", () => {
  const evening = meeting({
    day: 1,
    time: "19:00",
    types: ["O", "B"],
    tags: [{ slug: "welcoming", count: 3 }],
  });

  it("keeps everything with no filters", () => {
    expect(matchesFilters(evening, NO_FILTERS)).toBe(true);
  });

  it.each([
    [{ days: [1] }, true],
    [{ days: [2, 3] }, false],
    [{ times: ["evening"] }, true],
    [{ times: ["morning", "afternoon"] }, false],
    [{ types: ["O"] }, true],
    [{ types: ["O", "W"] }, false],
    [{ tags: ["welcoming"] }, true],
    [{ tags: ["welcoming", "quiet"] }, false],
  ] as const)("%j keeps it: %s", (change, kept) => {
    expect(matchesFilters(evening, { ...NO_FILTERS, ...change })).toBe(kept);
  });

  it("counts night as running past midnight", () => {
    expect(matchesFilters(meeting({ time: "23:30" }), { ...NO_FILTERS, times: ["night"] })).toBe(true);
    expect(matchesFilters(meeting({ time: "04:59" }), { ...NO_FILTERS, times: ["night"] })).toBe(true);
    expect(matchesFilters(meeting({ time: "05:00" }), { ...NO_FILTERS, times: ["night"] })).toBe(false);
  });
});

describe("byExactDistance", () => {
  it("re-sorts the server's order by the exact distance from the real point", () => {
    const far = nearbyMeeting({
      id: "11111111-1111-4111-8111-111111111111",
      latitude: 35.77,
      longitude: -83.99,
      distanceKm: 0.9,
    });
    const near = nearbyMeeting({
      id: "22222222-2222-4222-8222-222222222222",
      latitude: 35.7566,
      longitude: -83.9706,
      distanceKm: 1.6,
    });
    const sorted = byExactDistance([far, near], { latitude: 35.7565, longitude: -83.9705 });
    expect(sorted.map((m) => m.id)).toEqual([near.id, far.id]);
    expect(sorted[1]?.exactKm).toBeCloseTo(2.31, 2);
  });

  it("keeps the server's distance for a meeting without coordinates", () => {
    const unplaced = nearbyMeeting({ latitude: null, longitude: null, distanceKm: 3.2 });
    expect(byExactDistance([unplaced], { latitude: 35.7565, longitude: -83.9705 })[0]?.exactKm).toBe(3.2);
  });
});

describe("milesLabel", () => {
  it.each([
    [0.0143, "under 0.1 mi"],
    [2.3128, "1.4 mi"],
    [20, "12 mi"],
  ])("%d km reads %s", (km, label) => {
    expect(milesLabel(km)).toBe(label);
  });
});
```

- [ ] **Step 2: Run to verify they fail.** Run `pnpm --filter mobile test -- filters`. Expected: FAIL. The modules don't exist.

- [ ] **Step 3: Implement the pure parts.** Create `apps/mobile/src/meetings/type-labels.ts`:

```ts
import type { MEETING_TYPE_CODES } from "@mymeetingapp/shared";

export type MeetingTypeCode = (typeof MEETING_TYPE_CODES)[number];

// English names from the Meeting Guide spec (github.com/code4recovery/spec data/types.json, 2026-09), one per code the
// API returns. A code added to the shared list fails typecheck here until it has a name.
export const TYPE_LABELS: Record<MeetingTypeCode, string> = {
  "11": "11th Step Meditation",
  "12x12": "12 Steps & 12 Traditions",
  A: "Secular",
  ABSI: "As Bill Sees It",
  AF: "Afrikaans",
  AL: "Concurrent with Alateen",
  "AL-AN": "Concurrent with Al-Anon",
  AM: "Amharic",
  AR: "Arabic",
  ASL: "American Sign Language",
  B: "Big Book",
  BA: "Babysitting Available",
  BE: "Newcomer",
  BG: "Bulgarian",
  BI: "Bisexual",
  BRK: "Breakfast",
  C: "Closed",
  CAN: "Candlelight",
  CF: "Child-Friendly",
  D: "Discussion",
  DA: "Danish",
  DB: "Digital Basket",
  DD: "Dual Diagnosis",
  DE: "German",
  DR: "Daily Reflections",
  EL: "Greek",
  EN: "English",
  FA: "Persian",
  FI: "Finnish",
  FF: "Fragrance Free",
  FR: "French",
  G: "Gay",
  GR: "Grapevine",
  H: "Birthday",
  HE: "Hebrew",
  HI: "Hindi",
  HR: "Croatian",
  HU: "Hungarian",
  IS: "Icelandic",
  ITA: "Italian",
  JA: "Japanese",
  KA: "Georgian",
  KOR: "Korean",
  L: "Lesbian",
  LGBTQ: "LGBTQ",
  LIT: "Literature",
  LS: "Living Sober",
  LT: "Lithuanian",
  M: "Men",
  MED: "Meditation",
  ML: "Malayalam",
  MT: "Maltese",
  N: "Native American",
  NB: "Non-Binary",
  NDG: "Indigenous",
  NE: "Nepali",
  NL: "Dutch",
  NO: "Norwegian",
  O: "Open",
  OUT: "Outdoor",
  P: "Professionals",
  POA: "Proof of Attendance",
  POC: "People of Color",
  POL: "Polish",
  POR: "Portuguese",
  PUN: "Punjabi",
  RUS: "Russian",
  S: "Spanish",
  SEN: "Seniors",
  SK: "Slovak",
  SL: "Slovenian",
  SM: "Smoking Permitted",
  SP: "Speaker",
  ST: "Step Study",
  SV: "Swedish",
  T: "Transgender",
  TH: "Thai",
  TL: "Tagalog",
  TR: "Tradition Study",
  TUR: "Turkish",
  UK: "Ukrainian",
  W: "Women",
  X: "Wheelchair Access",
  XB: "Wheelchair-Accessible Bathroom",
  XT: "Cross Talk Permitted",
  Y: "Young People",
};

// The types offered as filters (decision 9); the meeting page shows all of them.
export const FILTER_TYPES: readonly MeetingTypeCode[] = [
  "O",
  "C",
  "BE",
  "W",
  "M",
  "Y",
  "LGBTQ",
  "S",
  "X",
  "SP",
  "D",
  "B",
  "ST",
  "MED",
];
```

Create `apps/mobile/src/meetings/units.ts`:

```ts
const MILES_PER_KM = 0.621371;

// A US app: distances in miles, one decimal below 10.
export function milesLabel(km: number): string {
  const miles = km * MILES_PER_KM;
  if (miles < 0.1) return "under 0.1 mi";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${String(Math.round(miles))} mi`;
}

export function radiusMiles(km: number): number {
  return Math.round(km * MILES_PER_KM);
}
```

Create `apps/mobile/src/search/nearby.ts`:

```ts
import { MeetingSearchResponse } from "@mymeetingapp/shared";

import { searchMeetings } from "@/api/reads";
import type { CachedRead } from "@/cache/cached-read";
import { distanceKm, type LatLng, roundForSearch } from "@/location/geo";

export interface SearchOrigin {
  kind: "me" | "place" | "map";
  // What the list says it's near: "you", the typed place, or "this map area".
  label: string;
  // The exact point, which stays on the phone.
  point: LatLng;
  radiusKm: number;
}

export type NearbyMeeting = MeetingSearchResponse["meetings"][number] & { exactKm: number };

// Only the rounded point and the radius leave the phone, in the POST body; the cache key uses the same rounded values.
export function searchRead(origin: SearchOrigin): CachedRead<typeof MeetingSearchResponse> {
  const rounded = roundForSearch(origin.point);
  const request = { lat: rounded.latitude, lng: rounded.longitude, radiusKm: origin.radiusKm };
  return {
    kind: "search",
    key: `search:${String(request.lat)},${String(request.lng)},${String(request.radiusKm)}`,
    schema: MeetingSearchResponse,
    fetch: () => searchMeetings(request),
  };
}

// Spec §8: the server sorts by distance from the rounded point; the phone re-sorts by the exact distance.
export function byExactDistance(meetings: MeetingSearchResponse["meetings"], from: LatLng): NearbyMeeting[] {
  return meetings
    .map((meeting) => ({
      ...meeting,
      exactKm:
        meeting.latitude === null || meeting.longitude === null
          ? meeting.distanceKm
          : distanceKm(from, { latitude: meeting.latitude, longitude: meeting.longitude }),
    }))
    .sort((a, b) => a.exactKm - b.exactKm);
}
```

Create `apps/mobile/src/search/filters.tsx`:

```tsx
import type { MeetingSummary } from "@mymeetingapp/shared";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";

import type { MeetingTypeCode } from "@/meetings/type-labels";

// On the meeting's listed time. Night runs past midnight.
export const TIMES_OF_DAY = {
  morning: { label: "Morning", from: "05:00", to: "12:00" },
  afternoon: { label: "Afternoon", from: "12:00", to: "17:00" },
  evening: { label: "Evening", from: "17:00", to: "21:00" },
  night: { label: "Night", from: "21:00", to: "05:00" },
} as const;
export type TimeOfDay = keyof typeof TIMES_OF_DAY;
export const TIME_ORDER: readonly TimeOfDay[] = ["morning", "afternoon", "evening", "night"];

export interface MeetingFilters {
  days: number[];
  times: TimeOfDay[];
  types: MeetingTypeCode[];
  tags: string[];
}

export const NO_FILTERS: MeetingFilters = { days: [], times: [], types: [], tags: [] };

function inTime(time: string, { from, to }: { from: string; to: string }): boolean {
  return from < to ? time >= from && time < to : time >= from || time < to;
}

// Spec §7: filtering by day, time, type and tag happens on the phone. Days and times match any chosen; types and tags
// must all be present.
export function matchesFilters(meeting: MeetingSummary, filters: MeetingFilters): boolean {
  return (
    (filters.days.length === 0 || filters.days.includes(meeting.day)) &&
    (filters.times.length === 0 || filters.times.some((time) => inTime(meeting.time, TIMES_OF_DAY[time]))) &&
    filters.types.every((type) => meeting.types.includes(type)) &&
    filters.tags.every((slug) => meeting.tags.some((tag) => tag.slug === slug))
  );
}

export function toggled<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

const Filters = createContext<{ filters: MeetingFilters; setFilters: (next: MeetingFilters) => void }>({
  filters: NO_FILTERS,
  setFilters: () => undefined,
});

// Held in memory only; filters are never saved (decision 9).
export function FiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState(NO_FILTERS);
  const value = useMemo(() => ({ filters, setFilters }), [filters]);
  return <Filters.Provider value={value}>{children}</Filters.Provider>;
}

export function useFilters() {
  return useContext(Filters);
}
```

- [ ] **Step 4: Run to verify they pass.** Run `pnpm --filter mobile test -- filters`. Expected: PASS (17 tests).

- [ ] **Step 5: Write the failing screen tests.** Create `apps/mobile/test/nearby.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

import { recentPlaces } from "@/location/recent-places";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, nearbyMeeting, VOCABULARY } from "./fixtures";
import { permissionRequests, setLocationPermission, setPermissionAnswer } from "./native/expo-location";
import { lookups, setPlace } from "./native/native-location";
import { renderApp } from "./render-app";

let api: TestApi;
const SEARCH = "/api/v1/meetings/search";
const searches = () => api.requests.filter((request) => request.path === SEARCH);

const far = nearbyMeeting({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Far Group",
  day: 1,
  time: "19:00",
  latitude: 35.77,
  longitude: -83.99,
  distanceKm: 0.9,
});
const near = nearbyMeeting({
  id: "22222222-2222-4222-8222-222222222222",
  name: "Near Group",
  day: 1,
  time: "08:00",
  latitude: 35.7566,
  longitude: -83.9706,
  distanceKm: 1.6,
  tags: [{ slug: "quiet", count: 2 }],
});

beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  setPlace("Maryville, TN", { latitude: 35.7565, longitude: -83.9705 });
  jest.spyOn(Linking, "openSettings").mockResolvedValue();
});
afterEach(async () => {
  await api.close();
});

async function searchFor(text: string) {
  fireEvent.changeText(await screen.findByLabelText("Search for a place"), text);
  fireEvent.press(screen.getByRole("button", { name: "Search" }));
}

describe("Nearby without location", () => {
  it("asks for nothing at launch", async () => {
    renderApp("/");
    expect(
      await screen.findByText("Search by city, zip code or address, or use your location."),
    ).toBeOnTheScreen();
    expect(permissionRequests()).toBe(0);
    expect(searches()).toHaveLength(0);
  });

  it("finds a typed place on the phone, sends only the rounded point, and sorts by exact distance", async () => {
    api.reply(SEARCH, { meetings: [far, near] });
    renderApp("/");
    await searchFor("Maryville, TN");
    expect(await screen.findByText("Near Maryville, TN")).toBeOnTheScreen();
    expect(lookups).toEqual(["Maryville, TN"]);
    expect(JSON.parse(searches()[0]?.body ?? "")).toEqual({ lat: 35.76, lng: -83.97, radiusKm: 25 });
    for (const request of api.requests) {
      expect(`${request.path} ${request.body}`).not.toMatch(/maryville/i);
    }
    const cards = screen.getAllByRole("button", { name: /Group, Mon/ });
    expect(cards.map((card) => card.props.accessibilityLabel)).toEqual([
      "Near Group, Mon 8:00 AM, under 0.1 mi, St. Luke's",
      "Far Group, Mon 7:00 PM, 1.4 mi, St. Luke's",
    ]);
    expect((await recentPlaces()).map((place) => place.label)).toEqual(["Maryville, TN"]);
  });

  it("a place the geocoder can't find sends nothing to the server", async () => {
    renderApp("/");
    await searchFor("Atlantis");
    expect(
      await screen.findByText("We couldn't find “Atlantis”. Try a city and state, or a zip code."),
    ).toBeOnTheScreen();
    expect(searches()).toHaveLength(0);
  });

  it("searches a recent place again without the geocoder", async () => {
    api.reply(SEARCH, { meetings: [near] });
    renderApp("/");
    await searchFor("Maryville, TN");
    await screen.findByText("Near Maryville, TN");
    fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    fireEvent.press(await screen.findByRole("button", { name: "Maryville, TN" }));
    expect(await screen.findByText("Near Maryville, TN")).toBeOnTheScreen();
    expect(lookups).toEqual(["Maryville, TN"]);
  });
});

describe("Nearby with location", () => {
  it("asks on the tap, then searches around the rounded point", async () => {
    api.reply(SEARCH, { meetings: [near] });
    renderApp("/");
    fireEvent.press(await screen.findByRole("button", { name: "Use my location" }));
    expect(await screen.findByText("Near you")).toBeOnTheScreen();
    expect(permissionRequests()).toBe(1);
    expect(JSON.parse(searches()[0]?.body ?? "")).toEqual({ lat: 36.16, lng: -86.78, radiusKm: 25 });
  });

  it("explains a refused permission and keeps place search", async () => {
    setPermissionAnswer("denied");
    renderApp("/");
    fireEvent.press(await screen.findByRole("button", { name: "Use my location" }));
    expect(
      await screen.findByText(
        "Location is off for mymeetingapp. Search by city, zip code or address instead, or turn location on in Settings.",
      ),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Open Settings" }));
    expect(Linking.openSettings).toHaveBeenCalled();
    expect(screen.getByLabelText("Search for a place")).toBeOnTheScreen();
    expect(searches()).toHaveLength(0);
  });

  it("starts near the person when location was allowed before", async () => {
    setLocationPermission("granted");
    api.reply(SEARCH, { meetings: [near] });
    renderApp("/");
    expect(await screen.findByText("Near you")).toBeOnTheScreen();
  });
});

describe("results", () => {
  it("says plainly when there are no in-person meetings, and shows online ones instead", async () => {
    setNow("2026-10-05T23:30:00Z");
    api.reply(SEARCH, { meetings: [] });
    api.reply("/api/v1/meetings/online?day=0", { meetings: [] });
    api.reply("/api/v1/meetings/online?day=1", {
      meetings: [
        meeting({
          name: "Zoom Early Evening",
          attendance: "online",
          conferenceUrl: "https://zoom.us/j/1",
          day: 1,
          time: "18:00",
          endTime: "19:00",
        }),
      ],
    });
    api.reply("/api/v1/meetings/online?day=2", { meetings: [] });
    renderApp("/");
    await searchFor("Maryville, TN");
    expect(
      await screen.findByText("No in-person meetings within 16 miles of Maryville, TN."),
    ).toBeOnTheScreen();
    expect(await screen.findByText("Zoom Early Evening")).toBeOnTheScreen();
  });

  it("narrows the list with filter pills, and clears them", async () => {
    api.reply(SEARCH, { meetings: [far, near] });
    renderApp("/");
    await searchFor("Maryville, TN");
    await screen.findByText("Near Group");
    fireEvent.press(screen.getByRole("button", { name: "Time filters" }));
    fireEvent.press(await screen.findByRole("checkbox", { name: "Evening" }));
    fireEvent.press(screen.getByRole("button", { name: "Show meetings" }));
    expect(await screen.findByText("Far Group")).toBeOnTheScreen();
    expect(screen.queryByText("Near Group")).toBeNull();
    fireEvent.press(screen.getByRole("button", { name: "Time filters, 1 chosen" }));
    fireEvent.press(await screen.findByRole("checkbox", { name: "Evening" }));
    fireEvent.press(screen.getByRole("checkbox", { name: "Night" }));
    fireEvent.press(screen.getByRole("button", { name: "Show meetings" }));
    expect(await screen.findByText("No meetings match your filters.")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByText("Near Group")).toBeOnTheScreen();
  });

  it("labels a saved search shown offline", async () => {
    setNow("2026-10-05T20:00:00Z");
    api.reply(SEARCH, { meetings: [near] });
    renderApp("/");
    await searchFor("Maryville, TN");
    await screen.findByText("Near Group");
    setNow("2026-10-05T21:20:00Z");
    await api.close();
    fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    fireEvent.press(await screen.findByRole("button", { name: "Maryville, TN" }));
    expect(
      await screen.findByText(
        "Showing the copy saved today at 3:00 PM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    api = await startApi();
  });
});
```

Choosing a recent place searches with the same cache key as before. The screen remounts the results on every search (a `key` counter), so the read runs again and a stale copy is refreshed or labelled.

- [ ] **Step 6: Run to verify they fail.** Run `pnpm --filter mobile test -- nearby`. Expected: FAIL. Nearby still shows only its sentence.

- [ ] **Step 7: Implement the pill, place search, filter sheet and screen.** Create `apps/mobile/src/ui/pill.tsx`:

```tsx
import { Pressable } from "react-native";

import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

interface PillProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  // A checkbox toggles a filter; a button opens the filter sheet. spokenLabel defaults to label.
  role?: "checkbox" | "button";
  spokenLabel?: string;
}

export function Pill({ label, selected, onPress, role = "checkbox", spokenLabel }: PillProps) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={spokenLabel ?? label}
      accessibilityState={role === "checkbox" ? { checked: selected } : { selected }}
      onPress={onPress}
      style={{
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: 14,
        justifyContent: "center",
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.line,
        backgroundColor: selected ? colors.tagBg : colors.surface,
      }}
    >
      <AppText variant="small" style={{ color: selected ? colors.accent : colors.text }}>
        {label}
      </AppText>
    </Pressable>
  );
}
```

Create `apps/mobile/src/ui/place-search.tsx`:

```tsx
import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";

import { forgetRecentPlaces, type RecentPlace, recentPlaces } from "@/location/recent-places";
import { useColors } from "@/theme/colors";
import { TEXT_STYLES } from "@/theme/type";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";

interface PlaceSearchProps {
  onPlace: (text: string) => void;
  onRecent: (place: RecentPlace) => void;
  onNearMe: () => void;
}

export function PlaceSearch({ onPlace, onRecent, onNearMe }: PlaceSearchProps) {
  const colors = useColors();
  const [text, setText] = useState("");
  const [recent, setRecent] = useState<RecentPlace[]>([]);
  useEffect(() => {
    void recentPlaces().then(setRecent);
  }, []);
  return (
    <View style={{ gap: 12 }}>
      <AppText>Search by city, zip code or address, or use your location.</AppText>
      <TextInput
        accessibilityLabel="Search for a place"
        placeholder="City, zip code or address"
        placeholderTextColor={colors.muted}
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => {
          onPlace(text);
        }}
        returnKeyType="search"
        autoCorrect={false}
        style={[
          TEXT_STYLES.body,
          {
            minHeight: 44,
            borderWidth: 1,
            borderColor: colors.line,
            borderRadius: 8,
            paddingHorizontal: 12,
            color: colors.text,
            backgroundColor: colors.surface,
          },
        ]}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button
          label="Search"
          onPress={() => {
            onPlace(text);
          }}
        />
        <Button label="Use my location" kind="secondary" onPress={onNearMe} />
      </View>
      <AppText variant="small" tone="muted">
        What you type and your exact location stay on this phone. A search sends only a point rounded to about
        1 km.
      </AppText>
      {recent.length > 0 && (
        <View style={{ gap: 8 }}>
          <AppText variant="label" accessibilityRole="header">
            Recent places
          </AppText>
          {recent.map((place) => (
            <Button
              key={place.label}
              kind="secondary"
              label={place.label}
              onPress={() => {
                onRecent(place);
              }}
            />
          ))}
          <Button
            kind="secondary"
            label="Clear recent places"
            onPress={() => {
              void forgetRecentPlaces().then(() => {
                setRecent([]);
              });
            }}
          />
        </View>
      )}
    </View>
  );
}
```

Create `apps/mobile/src/app/filters.tsx`:

```tsx
import { TAG_CATEGORIES } from "@mymeetingapp/shared";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";

import { FILTER_TYPES, TYPE_LABELS } from "@/meetings/type-labels";
import { WEEKDAYS } from "@/meetings/schedule";
import { useVocabularyTags } from "@/meetings/vocabulary";
import { NO_FILTERS, TIME_ORDER, TIMES_OF_DAY, toggled, useFilters } from "@/search/filters";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { Pill } from "@/ui/pill";
import { Screen } from "@/ui/screen";

const CATEGORY_TITLES = {
  format: "Format",
  sharing: "Sharing",
  crowd: "Crowd",
  feel: "Feel",
  practical: "Practical",
} as const;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>
    </View>
  );
}

export default function FiltersScreen() {
  const { filters, setFilters } = useFilters();
  const tags = [...useVocabularyTags().values()];
  return (
    <Screen>
      <Group title="Day">
        {WEEKDAYS.map((name, day) => (
          <Pill
            key={name}
            label={name}
            selected={filters.days.includes(day)}
            onPress={() => {
              setFilters({ ...filters, days: toggled(filters.days, day) });
            }}
          />
        ))}
      </Group>
      <Group title="Time of day">
        {TIME_ORDER.map((time) => (
          <Pill
            key={time}
            label={TIMES_OF_DAY[time].label}
            selected={filters.times.includes(time)}
            onPress={() => {
              setFilters({ ...filters, times: toggled(filters.times, time) });
            }}
          />
        ))}
      </Group>
      <Group title="Meeting type">
        {FILTER_TYPES.map((type) => (
          <Pill
            key={type}
            label={TYPE_LABELS[type]}
            selected={filters.types.includes(type)}
            onPress={() => {
              setFilters({ ...filters, types: toggled(filters.types, type) });
            }}
          />
        ))}
      </Group>
      <AppText tone="muted">What people say</AppText>
      {TAG_CATEGORIES.map((category) => (
        <Group key={category} title={CATEGORY_TITLES[category]}>
          {tags
            .filter((tag) => tag.category === category)
            .map((tag) => (
              <Pill
                key={tag.slug}
                label={tag.label}
                selected={filters.tags.includes(tag.slug)}
                onPress={() => {
                  setFilters({ ...filters, tags: toggled(filters.tags, tag.slug) });
                }}
              />
            ))}
        </Group>
      ))}
      <Button
        kind="secondary"
        label="Clear filters"
        onPress={() => {
          setFilters(NO_FILTERS);
        }}
      />
      <Button
        label="Show meetings"
        onPress={() => {
          router.back();
        }}
      />
    </Screen>
  );
}
```

Replace `apps/mobile/src/app/(tabs)/index.tsx`:

```tsx
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Linking, View } from "react-native";

import { useCachedRead } from "@/cache/use-cached-read";
import { useUpgradeRequired } from "@/config/upgrade";
import { currentPosition, locationAlreadyAllowed } from "@/location/current-position";
import { findPlace } from "@/location/find-place";
import { SEARCH_RADIUS_KM } from "@/location/geo";
import { type RecentPlace, rememberPlace } from "@/location/recent-places";
import { listedTime, WEEKDAYS_SHORT } from "@/meetings/schedule";
import { milesLabel, radiusMiles } from "@/meetings/units";
import { matchesFilters, NO_FILTERS, useFilters } from "@/search/filters";
import { byExactDistance, type SearchOrigin, searchRead } from "@/search/nearby";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { MeetingCard } from "@/ui/meeting-card";
import { OnlineNowList } from "@/ui/online-now-list";
import { Pill } from "@/ui/pill";
import { PlaceSearch } from "@/ui/place-search";
import { SavedCopyNote } from "@/ui/saved-copy-note";
import { Screen } from "@/ui/screen";
import { UpgradeNotice } from "@/ui/upgrade-notice";

const DENIED =
  "Location is off for mymeetingapp. Search by city, zip code or address instead, or turn location on in Settings.";
const UNAVAILABLE = "We couldn't get your location just now. Try again, or search by place.";
const BLANK = "Type a city, zip code or address.";
const notFound = (text: string) => `We couldn't find “${text}”. Try a city and state, or a zip code.`;

function FilterPills() {
  const { filters } = useFilters();
  const pills = [
    { name: "Day", count: filters.days.length },
    { name: "Time", count: filters.times.length },
    { name: "Type", count: filters.types.length },
    { name: "Tags", count: filters.tags.length },
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {pills.map(({ name, count }) => (
        <Pill
          key={name}
          role="button"
          label={count === 0 ? name : `${name} · ${String(count)}`}
          spokenLabel={count === 0 ? `${name} filters` : `${name} filters, ${String(count)} chosen`}
          selected={count > 0}
          onPress={() => {
            router.push("/filters");
          }}
        />
      ))}
    </View>
  );
}

function Results({ origin, onChangePlace }: { origin: SearchOrigin; onChangePlace: () => void }) {
  const { state } = useCachedRead(searchRead(origin));
  const { filters, setFilters } = useFilters();
  const heading = (
    <View style={{ gap: 12 }}>
      <AppText variant="title" accessibilityRole="header">
        {origin.kind === "me" ? "Near you" : `Near ${origin.label}`}
      </AppText>
      <Button kind="secondary" label="Change place" onPress={onChangePlace} />
    </View>
  );
  if (state.status === "loading")
    return (
      <Screen>
        {heading}
        <ActivityIndicator accessibilityLabel="Searching" />
      </Screen>
    );
  if (state.status === "failed")
    return (
      <Screen>
        {heading}
        <AppText>{state.message}</AppText>
      </Screen>
    );
  const sorted = byExactDistance(state.data.meetings, origin.point);
  if (sorted.length === 0) {
    return (
      <Screen>
        {heading}
        <AppText>{`No in-person meetings within ${String(radiusMiles(origin.radiusKm))} miles of ${origin.kind === "me" ? "you" : origin.label}.`}</AppText>
        <AppText variant="heading" accessibilityRole="header">
          Online meetings you can join
        </AppText>
        <OnlineNowList />
      </Screen>
    );
  }
  const shown = sorted.filter((meeting) => matchesFilters(meeting, filters));
  return (
    <FlatList
      data={shown}
      keyExtractor={(meeting) => meeting.id}
      contentContainerStyle={{ padding: 20, gap: 12 }}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          {heading}
          {state.savedAt !== null && <SavedCopyNote savedAt={state.savedAt} />}
          <FilterPills />
          {shown.length === 0 && (
            <>
              <AppText>No meetings match your filters.</AppText>
              <Button
                kind="secondary"
                label="Clear filters"
                onPress={() => {
                  setFilters(NO_FILTERS);
                }}
              />
            </>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <MeetingCard
          meeting={item}
          when={`${WEEKDAYS_SHORT[item.day] ?? ""} ${listedTime(item.time)}`}
          distance={milesLabel(item.exactKm)}
        />
      )}
    />
  );
}

function Nearby() {
  const [origin, setOrigin] = useState<SearchOrigin | null>(null);
  // Each search remounts the results, so searching the same place again reads again (a stale copy refreshes).
  const [searchCount, setSearchCount] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const search = useCallback((next: SearchOrigin) => {
    setOrigin(next);
    setSearchCount((count) => count + 1);
  }, []);

  const searchNearMe = useCallback(async () => {
    setProblem(null);
    const result = await currentPosition();
    if (result.status === "denied") setProblem(DENIED);
    else if (result.status === "unavailable") setProblem(UNAVAILABLE);
    else search({ kind: "me", label: "you", point: result.point, radiusKm: SEARCH_RADIUS_KM });
  }, [search]);

  useEffect(() => {
    let live = true;
    void locationAlreadyAllowed().then((allowed) => {
      if (allowed && live) void searchNearMe();
    });
    return () => {
      live = false;
    };
  }, [searchNearMe]);

  async function searchPlace(text: string) {
    setProblem(null);
    const label = text.trim();
    if (label === "") {
      setProblem(BLANK);
      return;
    }
    const point = await findPlace(label);
    if (point === null) {
      setProblem(notFound(label));
      return;
    }
    await rememberPlace(label, point);
    search({ kind: "place", label, point, radiusKm: SEARCH_RADIUS_KM });
  }

  function searchRecent(place: RecentPlace) {
    setProblem(null);
    void rememberPlace(place.label, place);
    search({
      kind: "place",
      label: place.label,
      point: { latitude: place.latitude, longitude: place.longitude },
      radiusKm: SEARCH_RADIUS_KM,
    });
  }

  if (origin !== null) {
    return (
      <Results
        key={searchCount}
        origin={origin}
        onChangePlace={() => {
          setOrigin(null);
        }}
      />
    );
  }
  return (
    <Screen>
      <PlaceSearch
        onPlace={(text) => void searchPlace(text)}
        onRecent={searchRecent}
        onNearMe={() => void searchNearMe()}
      />
      {problem !== null && <AppText accessibilityRole="alert">{problem}</AppText>}
      {problem === DENIED && (
        <Button kind="secondary" label="Open Settings" onPress={() => void Linking.openSettings()} />
      )}
    </Screen>
  );
}

export default function NearbyScreen() {
  if (useUpgradeRequired()) return <UpgradeNotice />;
  return <Nearby />;
}
```

In `src/app/_layout.tsx`, wrap the tree in `<FiltersProvider>` (inside `VocabularyProvider`), and add `<Stack.Screen name="filters" options={{ presentation: "modal", title: "Filters" }} />`.

- [ ] **Step 8: Run to verify they pass.** Run `pnpm --filter mobile test`. Expected: PASS. If the card-order test fails on the labels, the cards' `accessibilityLabel` is `[name, when, distance, locationName]` joined with ", " (Task 6), and the fixture's location is "St. Luke's".

- [ ] **Step 9: Check and commit.** Run `pnpm check`, then:

```bash
git add apps/mobile
git commit -m "feat(mobile): Nearby list with place and location search, exact sorting, filters and the online fallback"
```

---

### Task 9: The map, and searching by panning

Results can be shown on a map: Apple Maps on iOS, Google Maps on Android. Panning or zooming searches around the new map center, with the radius taken from the visible area (spec §8), and only the rounded center is sent. The map keeps the person's view while it searches, so the search doesn't jump the map back.

**Files:**

- Create: `apps/mobile/src/ui/results-map.tsx`, `apps/mobile/test/native/react-native-maps.tsx`, `apps/mobile/test/map.test.tsx`
- Modify: `apps/mobile/src/location/geo.ts`, `apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/app.config.ts`, `apps/mobile/jest.config.js`, `apps/mobile/package.json`, `docs/mobile.md`

**Interfaces:**

- Consumes: `radiusForRegion`, `MapRegion` (Task 7); `searchRead`, `byExactDistance`, `matchesFilters` and `Results` (Task 8).
- Produces:
  - `regionAround(point: LatLng, radiusKm: number): MapRegion` from `@/location/geo`;
  - `<ResultsMap initialRegion meetings onMove showsUser />` from `@/ui/results-map`;
  - the `view` state (`"list" | "map"`) in Nearby, toggled by the "List" and "Map" pills.

- [ ] **Step 1: Fake the map.** Run `pnpm --filter mobile exec expo install react-native-maps` (1.27.2 for SDK 57). Create `apps/mobile/test/native/react-native-maps.tsx`:

```tsx
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

// The map's props land on a plain View, so tests can read initialRegion and fire regionChangeComplete. Each marker is a
// button named by its accessibilityLabel.
export default function MapView({ children, ...props }: { children?: ReactNode; [prop: string]: unknown }) {
  return <View {...props}>{children}</View>;
}

export function Marker({
  title,
  accessibilityLabel,
  onCalloutPress,
}: {
  title: string;
  accessibilityLabel: string;
  onCalloutPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onCalloutPress}>
      <Text>{title}</Text>
    </Pressable>
  );
}
```

Map `"^react-native-maps$": "<rootDir>/test/native/react-native-maps.tsx"` in `jest.config.js`, above `"^@/(.*)$"`.

- [ ] **Step 2: Write the failing tests.** Create `apps/mobile/test/map.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react-native";

import { radiusForRegion, regionAround } from "@/location/geo";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { CONFIG, nearbyMeeting, VOCABULARY } from "./fixtures";
import { setPlace } from "./native/native-location";
import { renderApp } from "./render-app";

let api: TestApi;
const SEARCH = "/api/v1/meetings/search";
const searchBodies = () =>
  api.requests.filter((r) => r.path === SEARCH).map((r) => JSON.parse(r.body) as unknown);

const far = nearbyMeeting({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Far Group",
  day: 1,
  time: "19:00",
  latitude: 35.77,
  longitude: -83.99,
});
const unplaced = nearbyMeeting({
  id: "33333333-3333-4333-8333-333333333333",
  name: "Unplaced Group",
  latitude: null,
  longitude: null,
});

beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  api.reply(SEARCH, { meetings: [far, unplaced] });
  setPlace("Maryville, TN", { latitude: 35.7565, longitude: -83.9705 });
});
afterEach(async () => {
  await api.close();
});

describe("regionAround", () => {
  it("frames the search radius, and the map's radius covers its corners", () => {
    const region = regionAround({ latitude: 36.16, longitude: -86.78 }, 25);
    expect(region.latitudeDelta).toBeCloseTo(0.4492, 4);
    expect(region.longitudeDelta).toBeCloseTo(0.5563, 4);
    expect(radiusForRegion(region)).toBe(36);
  });
});

async function openMap() {
  renderApp("/");
  fireEvent.changeText(await screen.findByLabelText("Search for a place"), "Maryville, TN");
  fireEvent.press(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("Far Group");
  fireEvent.press(screen.getByRole("button", { name: "Map" }));
  return screen.findByTestId("results-map");
}

describe("the results map", () => {
  it("opens around the searched place with a marker for each placed meeting", async () => {
    const map = await openMap();
    expect(map.props.initialRegion.latitude).toBe(35.7565);
    expect(map.props.initialRegion.latitudeDelta).toBeCloseTo(0.4492, 4);
    expect(screen.getByRole("button", { name: "Far Group, Mon 7:00 PM" })).toBeOnTheScreen();
    expect(screen.queryByText("Unplaced Group")).toBeNull();
  });

  it("searches around the new center after a pan, sending only the rounded center", async () => {
    const map = await openMap();
    fireEvent(map, "regionChangeComplete", {
      latitude: 35.8012,
      longitude: -83.9021,
      latitudeDelta: 0.2,
      longitudeDelta: 0.3,
    });
    expect(await screen.findByText("Near this map area")).toBeOnTheScreen();
    expect(searchBodies()).toEqual([
      { lat: 35.76, lng: -83.97, radiusKm: 25 },
      { lat: 35.8, lng: -83.9, radiusKm: 18 },
    ]);
    expect(screen.getByTestId("results-map")).toBe(map);
  });

  it("doesn't search again when the rounded center and radius haven't changed", async () => {
    const map = await openMap();
    fireEvent(map, "regionChangeComplete", {
      latitude: 35.8012,
      longitude: -83.9021,
      latitudeDelta: 0.2,
      longitudeDelta: 0.3,
    });
    await screen.findByText("Near this map area");
    fireEvent(map, "regionChangeComplete", {
      latitude: 35.8049,
      longitude: -83.9049,
      latitudeDelta: 0.2,
      longitudeDelta: 0.3,
    });
    expect(searchBodies()).toHaveLength(2);
  });
});
```

(35.8012, -83.9021 rounds to 35.8, -83.9. The 0.2 × 0.3 region is 18 km, as in Task 7.)

- [ ] **Step 3: Run to verify they fail.** Run `pnpm --filter mobile test -- map`. Expected: FAIL. There's no `regionAround` and no "Map" pill.

- [ ] **Step 4: Implement.** Append to `apps/mobile/src/location/geo.ts`:

```ts
// The map's first view: a square around the point, as tall as the search is wide.
export function regionAround(point: LatLng, radiusKm: number): MapRegion {
  const latitudeDelta = (radiusKm * 2) / KM_PER_DEGREE;
  return { ...point, latitudeDelta, longitudeDelta: latitudeDelta / Math.cos(toRadians(point.latitude)) };
}
```

Create `apps/mobile/src/ui/results-map.tsx`:

```tsx
import { router } from "expo-router";
import MapView, { Marker } from "react-native-maps";

import type { MapRegion } from "@/location/geo";
import { listedTime, WEEKDAYS_SHORT } from "@/meetings/schedule";
import type { NearbyMeeting } from "@/search/nearby";

interface ResultsMapProps {
  initialRegion: MapRegion;
  meetings: NearbyMeeting[];
  onMove: (region: MapRegion) => void;
  showsUser: boolean;
}

// Apple Maps on iOS, Google Maps on Android (spec §8). The map is only ever given initialRegion and never moved by
// code, so every region change it reports is the person's own pan or zoom.
export function ResultsMap({ initialRegion, meetings, onMove, showsUser }: ResultsMapProps) {
  return (
    <MapView
      testID="results-map"
      accessibilityLabel="Map of meetings"
      style={{ flex: 1, minHeight: 320 }}
      initialRegion={initialRegion}
      showsUserLocation={showsUser}
      onRegionChangeComplete={(region) => {
        onMove(region);
      }}
    >
      {meetings.flatMap((meeting) => {
        if (meeting.latitude === null || meeting.longitude === null) return [];
        const when = `${WEEKDAYS_SHORT[meeting.day] ?? ""} ${listedTime(meeting.time)}`;
        return [
          <Marker
            key={meeting.id}
            coordinate={{ latitude: meeting.latitude, longitude: meeting.longitude }}
            title={meeting.name}
            description={when}
            accessibilityLabel={`${meeting.name}, ${when}`}
            onCalloutPress={() => {
              router.push(`/meeting/${meeting.id}`);
            }}
          />,
        ];
      })}
    </MapView>
  );
}
```

In `apps/mobile/src/app/(tabs)/index.tsx`, import `type MapRegion`, `radiusForRegion` and `regionAround` from `@/location/geo`, and `ResultsMap` from `@/ui/results-map`. Then:

1. In `Nearby`, add `const [view, setView] = useState<"list" | "map">("list");` and a map mover that changes the origin without remounting the results:

```tsx
// Spec §8: panning searches around the new center, with the radius from the visible area. The same rounded center
// and radius is the same search, so small drags send nothing.
const moveMap = useCallback((region: MapRegion) => {
  setOrigin((current) => {
    const next: SearchOrigin = {
      kind: "map",
      label: "this map area",
      point: { latitude: region.latitude, longitude: region.longitude },
      radiusKm: radiusForRegion(region),
    };
    return current !== null && searchRead(current).key === searchRead(next).key ? current : next;
  });
}, []);
```

Pass `view`, `onView={setView}` and `onMapMove={moveMap}` to `<Results>`.

2. `Results` now takes `{ origin: SearchOrigin; view: "list" | "map"; onView: (view: "list" | "map") => void; onMapMove: (region: MapRegion) => void; onChangePlace: () => void }`. Add the toggle to `heading`:

```tsx
<View style={{ flexDirection: "row", gap: 8 }}>
  <Pill
    role="button"
    label="List"
    selected={view === "list"}
    onPress={() => {
      onView("list");
    }}
  />
  <Pill
    role="button"
    label="Map"
    selected={view === "map"}
    onPress={() => {
      onView("map");
    }}
  />
</View>
```

Hold the first region for as long as these results are mounted (`Nearby` remounts them only for a new place or location search):

```tsx
const [initialRegion] = useState(() => regionAround(origin.point, origin.radiusKm));
```

Before the loading and failure returns, render the map view so it stays mounted while a pan's search loads:

```tsx
if (view === "map") {
  const placed =
    state.status === "ready"
      ? byExactDistance(state.data.meetings, origin.point).filter((meeting) =>
          matchesFilters(meeting, filters),
        )
      : [];
  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      {heading}
      {state.status === "ready" && state.savedAt !== null && <SavedCopyNote savedAt={state.savedAt} />}
      {state.status === "failed" && <AppText>{state.message}</AppText>}
      <FilterPills />
      <ResultsMap
        initialRegion={initialRegion}
        meetings={placed}
        onMove={onMapMove}
        showsUser={origin.kind === "me"}
      />
      {state.status === "loading" && <ActivityIndicator accessibilityLabel="Searching" />}
    </View>
  );
}
```

In `apps/mobile/app.config.ts`, add the plugin `["react-native-maps", { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }]`. iOS needs no key: Apple Maps is the default. In `docs/mobile.md`, add under "Local setup": "Android maps need `GOOGLE_MAPS_ANDROID_API_KEY` (owner decision 5): an EAS secret for EAS builds, and exported in the shell for `pnpm --filter mobile android`. Without it the Android map is blank; iOS needs nothing."

- [ ] **Step 5: Run to verify they pass.** Run `pnpm --filter mobile test`. Expected: PASS. The pan test checks that `getByTestId("results-map")` is the same element: the map wasn't remounted by the search.

- [ ] **Step 6: Check and commit.** Run `pnpm check`, then:

```bash
git add apps/mobile docs/mobile.md pnpm-lock.yaml
git commit -m "feat(mobile): results map with search by panning, sending only the rounded center"
```

---

### Task 10: Meeting details, directions and merged meetings

The meeting page shows:

- when the meeting is, in its own time and, if different, the phone's;
- where it is, with Directions handed to Apple Maps or Google Maps;
- how to join online;
- its types;
- "What people say" (every tag, with counts);
- where the listing came from.

A merged-away id comes back as the surviving meeting under its own id. The page follows it, and everything the phone keeps under the old id moves to the new one (owner decision 6). 5b adds the tagging buttons, and Task 11 adds the Save heart.

**Files:**

- Create: `apps/mobile/src/app/meeting/[id].tsx`, `apps/mobile/src/meetings/directions.ts`, `apps/mobile/src/meetings/merged.ts`, `apps/mobile/test/meeting-detail.test.tsx`
- Modify: `apps/mobile/src/meetings/schedule.ts` (adds `yourTime`), `apps/mobile/src/app/_layout.tsx` (adds the `meeting/[id]` screen)

**Interfaces:**

- Consumes: `fetchMeeting` (Task 3), `useCachedRead`, `SavedCopyNote` and the cache store (Task 4), `TagChips`, `listedTime`, `nextStart`, `WEEKDAYS` and `clockLabel` (Tasks 4 and 6), `TYPE_LABELS` (Task 8).
- Produces:
  - `directionsUrl(meeting: Pick<MeetingSummary, "latitude" | "longitude" | "formattedAddress">, platform: "ios" | "android"): string | null` from `@/meetings/directions`;
  - `meetingMoved(from: string, to: string): Promise<void>` from `@/meetings/merged` (Task 11 and 5b extend it);
  - `yourTime(meeting: Scheduled, now: Date): string | null` from `@/meetings/schedule`;
  - the route `/meeting/[id]`.

- [ ] **Step 1: Write the failing tests.** Create `apps/mobile/test/meeting-detail.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

import { readCache, writeCache } from "@/cache/store";
import { directionsUrl } from "@/meetings/directions";
import { yourTime } from "@/meetings/schedule";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, nearbyMeeting, VOCABULARY } from "./fixtures";
import { setPlace } from "./native/native-location";
import { renderApp } from "./render-app";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SURVIVOR = "9b2e4c1a-5d6f-4a7b-8c9d-0e1f2a3b4c5d";
let api: TestApi;

beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});
afterEach(async () => {
  await api.close();
});

describe("directionsUrl", () => {
  it.each([
    [
      { latitude: 36.1627, longitude: -86.7816, formattedAddress: "1 Main St" },
      "ios",
      "https://maps.apple.com/?daddr=36.1627%2C-86.7816",
    ],
    [
      { latitude: null, longitude: null, formattedAddress: "1 Main St, Nashville, TN" },
      "android",
      "https://www.google.com/maps/dir/?api=1&destination=1%20Main%20St%2C%20Nashville%2C%20TN",
    ],
    [{ latitude: null, longitude: null, formattedAddress: null }, "ios", null],
  ] as const)("%j on %s opens %s", (place, platform, url) => {
    expect(directionsUrl(place, platform)).toBe(url);
  });
});

describe("yourTime", () => {
  it("says when a meeting in another zone is on the phone's clock", () => {
    const eastern = { day: 1, time: "19:30", endTime: null, timezone: "America/New_York" };
    expect(yourTime(eastern, new Date("2026-10-05T12:00:00Z"))).toBe("That's Monday at 6:30 PM your time.");
  });

  it("says nothing when the phone keeps the meeting's time", () => {
    const central = { day: 1, time: "19:30", endTime: null, timezone: "America/Chicago" };
    expect(yourTime(central, new Date("2026-10-05T12:00:00Z"))).toBeNull();
  });
});

describe("the meeting page", () => {
  it("shows when, where, types, what people say and where the listing came from", async () => {
    api.reply(`/api/v1/meetings/${ID}`, { meeting: meeting() });
    renderApp(`/meeting/${ID}`);
    expect(await screen.findByText("Mondays, 12:00 PM to 1:00 PM")).toBeOnTheScreen();
    expect(screen.getByText("1 Main St, Nashville, TN 37203, USA")).toBeOnTheScreen();
    expect(screen.getByText("Open · Big Book")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "What people say" })).toBeOnTheScreen();
    expect(screen.getByLabelText("Welcoming, 14 people")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Directions" }));
    expect(Linking.openURL).toHaveBeenCalledWith("https://maps.apple.com/?daddr=36.1627%2C-86.7816");
    fireEvent.press(screen.getByRole("button", { name: "Listed by aanashville.org" }));
    expect(Linking.openURL).toHaveBeenCalledWith("https://aanashville.org/meetings/nooners");
  });

  it("offers joining online instead of directions for an online meeting", async () => {
    api.reply(`/api/v1/meetings/${ID}`, {
      meeting: meeting({
        attendance: "online",
        locationName: null,
        formattedAddress: null,
        latitude: null,
        longitude: null,
        conferenceUrl: "https://zoom.us/j/123456",
        conferencePhone: "+1 646 558 8656,,123456#",
      }),
    });
    renderApp(`/meeting/${ID}`);
    fireEvent.press(await screen.findByRole("button", { name: "Join online" }));
    expect(Linking.openURL).toHaveBeenCalledWith("https://zoom.us/j/123456");
    fireEvent.press(screen.getByRole("button", { name: "Dial in" }));
    expect(Linking.openURL).toHaveBeenCalledWith("tel:+16465588656,,123456#");
    expect(screen.queryByRole("button", { name: "Directions" })).toBeNull();
  });

  it("shows no tags for a group that asked not to be tagged", async () => {
    api.reply(`/api/v1/meetings/${ID}`, { meeting: meeting({ tagsDisabled: true, tags: [] }) });
    renderApp(`/meeting/${ID}`);
    expect(await screen.findByText("This group has asked not to be tagged.")).toBeOnTheScreen();
  });

  it("says so when no one has tagged it", async () => {
    api.reply(`/api/v1/meetings/${ID}`, { meeting: meeting({ tags: [] }) });
    renderApp(`/meeting/${ID}`);
    expect(await screen.findByText("No one has tagged this meeting yet.")).toBeOnTheScreen();
  });

  it("follows a merged meeting to its new id, moving its saved copy", async () => {
    api.reply(`/api/v1/meetings/${ID}`, { meeting: meeting({ id: SURVIVOR, name: "Nooners (merged)" }) });
    renderApp(`/meeting/${ID}`);
    expect(await screen.findByText("Nooners (merged)")).toBeOnTheScreen();
    await screen.findByText("Mondays, 12:00 PM to 1:00 PM");
    expect(screen).toHavePathname(`/meeting/${SURVIVOR}`);
    expect(await readCache(`meeting:${ID}`)).toBeNull();
    expect(await readCache(`meeting:${SURVIVOR}`)).not.toBeNull();
  });

  it("passes on the server's words for a meeting that's gone", async () => {
    api.reply(
      `/api/v1/meetings/${ID}`,
      {
        error: {
          code: "meeting_not_found",
          message: "We couldn't find that meeting. It may have been removed from the meeting list.",
        },
      },
      404,
    );
    renderApp(`/meeting/${ID}`);
    expect(
      await screen.findByText(
        "We couldn't find that meeting. It may have been removed from the meeting list.",
      ),
    ).toBeOnTheScreen();
  });

  it("labels an old saved copy shown offline", async () => {
    setNow("2026-10-05T20:00:00Z");
    await writeCache(`meeting:${ID}`, { meeting: meeting() });
    setNow("2026-10-05T21:30:00Z");
    await api.close();
    renderApp(`/meeting/${ID}`);
    expect(
      await screen.findByText(
        "Showing the copy saved today at 3:00 PM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    api = await startApi();
  });

  it("opens from a marker on the results map", async () => {
    setPlace("Maryville, TN", { latitude: 35.7565, longitude: -83.9705 });
    api.reply("/api/v1/meetings/search", { meetings: [nearbyMeeting()] });
    api.reply(`/api/v1/meetings/${ID}`, { meeting: meeting() });
    renderApp("/");
    fireEvent.changeText(await screen.findByLabelText("Search for a place"), "Maryville, TN");
    fireEvent.press(screen.getByRole("button", { name: "Search" }));
    fireEvent.press(await screen.findByRole("button", { name: "Map" }));
    fireEvent.press(await screen.findByRole("button", { name: "Nooners, Mon 12:00 PM" }));
    expect(await screen.findByText("Mondays, 12:00 PM to 1:00 PM")).toBeOnTheScreen();
  });
});
```

- [ ] **Step 2: Run to verify they fail.** Run `pnpm --filter mobile test -- meeting-detail`. Expected: FAIL. The route and helpers don't exist.

- [ ] **Step 3: Implement.** Create `apps/mobile/src/meetings/directions.ts`:

```ts
import type { MeetingSummary } from "@mymeetingapp/shared";

// Spec §8: directions hand off to Apple Maps or Google Maps, which start from the phone's own location; the app sends
// only the meeting's place. Coordinates when known, else the address.
export function directionsUrl(
  meeting: Pick<MeetingSummary, "latitude" | "longitude" | "formattedAddress">,
  platform: "ios" | "android",
): string | null {
  const destination =
    meeting.latitude !== null && meeting.longitude !== null
      ? `${String(meeting.latitude)},${String(meeting.longitude)}`
      : meeting.formattedAddress;
  if (destination === null) return null;
  const encoded = encodeURIComponent(destination);
  return platform === "ios"
    ? `https://maps.apple.com/?daddr=${encoded}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
}
```

Create `apps/mobile/src/meetings/merged.ts`:

```ts
import { appDatabase } from "@/db/database";

// Owner decision 6 (spec §7): GET /meetings/:id answers a merged-away id with the surviving meeting under its own id.
// Everything the phone keeps under the old id follows it.
export async function meetingMoved(from: string, to: string): Promise<void> {
  const db = await appDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      "insert or replace into cache_entries (key, body, saved_at) select ?, body, saved_at from cache_entries where key = ?",
      [`meeting:${to}`, `meeting:${from}`],
    );
    await db.runAsync("delete from cache_entries where key = ?", [`meeting:${from}`]);
  });
}
```

Append to `apps/mobile/src/meetings/schedule.ts`:

```ts
// When the phone's clock shows a different day or time from the listing (a meeting in another zone), say what it is
// on the phone.
export function yourTime(meeting: Scheduled, now: Date): string | null {
  const start = nextStart(meeting, now);
  const same =
    start.getDay() === meeting.day &&
    start.getHours() === hourOf(meeting.time) &&
    start.getMinutes() === minuteOf(meeting.time);
  if (same) return null;
  return `That's ${WEEKDAYS[start.getDay()] ?? ""} at ${clockLabel(start.getHours(), start.getMinutes())} your time.`;
}
```

Create `apps/mobile/src/app/meeting/[id].tsx`:

```tsx
import { MeetingDetailResponse, type MeetingSummary } from "@mymeetingapp/shared";
import { router, useLocalSearchParams } from "expo-router";
import { type ReactNode, useEffect } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { z } from "zod";

import { fetchMeeting } from "@/api/reads";
import { useCachedRead } from "@/cache/use-cached-read";
import { appPlatform } from "@/config/app-version";
import { directionsUrl } from "@/meetings/directions";
import { meetingMoved } from "@/meetings/merged";
import { listedTime, WEEKDAYS, yourTime } from "@/meetings/schedule";
import { TYPE_LABELS } from "@/meetings/type-labels";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { SavedCopyNote } from "@/ui/saved-copy-note";
import { Screen } from "@/ui/screen";
import { TagChips } from "@/ui/tag-chips";

const Params = z.object({ id: z.uuid() });

const detailRead = (id: string) =>
  ({
    kind: "meetingDetail",
    key: `meeting:${id}`,
    schema: MeetingDetailResponse,
    fetch: () => fetchMeeting(id),
  }) as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="heading" accessibilityRole="header">
        {title}
      </AppText>
      {children}
    </View>
  );
}

// React Native's URL has no hostname getter, so the host is read with a pattern.
const hostOf = (url: string) => /^https?:\/\/([^/?#]+)/.exec(url)?.[1] ?? url;

// Each link button takes a value already known to be there, so nothing inside a closure needs a fallback.
function LinkButton({ label, url, kind }: { label: string; url: string; kind?: "primary" | "secondary" }) {
  return <Button kind={kind} label={label} onPress={() => void Linking.openURL(url)} />;
}

// Keeps digits, "+" and the pause and extension characters (",", ";", "#", "*").
const dialable = (phone: string) => `tel:${phone.replace(/[^\d+,;#*]/g, "")}`;

function MeetingInfo({ meeting }: { meeting: MeetingSummary }) {
  const when = `${WEEKDAYS[meeting.day] ?? ""}s, ${listedTime(meeting.time)}${meeting.endTime === null ? "" : ` to ${listedTime(meeting.endTime)}`}`;
  const phoneTime =
    meeting.timezone === null ? null : yourTime({ ...meeting, timezone: meeting.timezone }, new Date());
  const directions = meeting.attendance === "online" ? null : directionsUrl(meeting, appPlatform());
  return (
    <>
      <AppText variant="title" accessibilityRole="header">
        {meeting.name}
      </AppText>
      <AppText>{when}</AppText>
      {phoneTime !== null && <AppText tone="muted">{phoneTime}</AppText>}
      {meeting.attendance !== "online" && (
        <Section title="Where">
          {meeting.locationName !== null && <AppText variant="label">{meeting.locationName}</AppText>}
          {meeting.formattedAddress !== null && <AppText>{meeting.formattedAddress}</AppText>}
          {meeting.locationNotes !== null && <AppText tone="muted">{meeting.locationNotes}</AppText>}
          {directions !== null && <LinkButton label="Directions" url={directions} />}
        </Section>
      )}
      {meeting.attendance !== "in_person" && (
        <Section title="Online">
          {meeting.conferenceUrl !== null && <LinkButton label="Join online" url={meeting.conferenceUrl} />}
          {meeting.conferenceUrlNotes !== null && (
            <AppText tone="muted">{meeting.conferenceUrlNotes}</AppText>
          )}
          {meeting.conferencePhone !== null && (
            <LinkButton kind="secondary" label="Dial in" url={dialable(meeting.conferencePhone)} />
          )}
          {meeting.conferencePhoneNotes !== null && (
            <AppText tone="muted">{meeting.conferencePhoneNotes}</AppText>
          )}
        </Section>
      )}
      {meeting.types.length > 0 && (
        <Section title="Meeting type">
          <AppText>{meeting.types.map((type) => TYPE_LABELS[type]).join(" · ")}</AppText>
        </Section>
      )}
      <Section title="What people say">
        {meeting.tagsDisabled ? (
          <AppText>This group has asked not to be tagged.</AppText>
        ) : meeting.tags.length === 0 ? (
          <AppText>No one has tagged this meeting yet.</AppText>
        ) : (
          <TagChips tags={meeting.tags} />
        )}
      </Section>
      {(meeting.notes !== null || meeting.groupName !== null) && (
        <Section title="Notes">
          {meeting.groupName !== null && <AppText>{meeting.groupName}</AppText>}
          {meeting.notes !== null && <AppText>{meeting.notes}</AppText>}
        </Section>
      )}
      <AppText variant="small" tone="muted">
        Listings come from local AA service offices and may be out of date.
      </AppText>
      {meeting.sourceUrl !== null && (
        <LinkButton
          kind="secondary"
          label={`Listed by ${hostOf(meeting.sourceUrl)}`}
          url={meeting.sourceUrl}
        />
      )}
    </>
  );
}

function MeetingDetail({ id }: { id: string }) {
  const { state } = useCachedRead(detailRead(id));
  useEffect(() => {
    if (state.status !== "ready" || state.data.meeting.id === id) return;
    const survivor = state.data.meeting.id;
    void meetingMoved(id, survivor).then(() => {
      router.setParams({ id: survivor });
    });
  }, [state, id]);
  if (state.status === "loading") return <ActivityIndicator accessibilityLabel="Loading the meeting" />;
  if (state.status === "failed") return <AppText>{state.message}</AppText>;
  return (
    <>
      {state.savedAt !== null && <SavedCopyNote savedAt={state.savedAt} />}
      <MeetingInfo meeting={state.data.meeting} />
    </>
  );
}

export default function MeetingScreen() {
  const params = Params.safeParse(useLocalSearchParams());
  return (
    <Screen>
      {params.success ? (
        <MeetingDetail id={params.data.id} />
      ) : (
        <AppText>That meeting link isn't valid.</AppText>
      )}
    </Screen>
  );
}
```

In `src/app/_layout.tsx`, add `<Stack.Screen name="meeting/[id]" options={{ title: "Meeting" }} />`.

- [ ] **Step 4: Run to verify they pass.** Run `pnpm --filter mobile test`. Expected: PASS.

- [ ] **Step 5: Check and commit.** Run `pnpm check`, then:

```bash
git add apps/mobile
git commit -m "feat(mobile): meeting page with directions, joining online, what people say, and merged ids"
```

---

### Task 11: Favorites and the Saved tab

A Save heart on the meeting page keeps the meeting on the phone. The Saved tab lists saved meetings, refreshes each one within its reuse window, and works offline from saved copies (spec §8). A saved meeting that merged stays saved under its new id; one no longer listed says so and can be removed. At launch, old cached copies are pruned, except those of saved meetings.

**Files:**

- Create:
  - `apps/mobile/src/saved/favorites.ts`, `apps/mobile/src/meetings/detail-read.ts`, `apps/mobile/src/cache/prune.ts`
  - `apps/mobile/src/ui/save-button.tsx`
  - `apps/mobile/test/saved.test.tsx`
- Modify:
  - `apps/mobile/src/db/migrations.ts`, `apps/mobile/src/meetings/merged.ts`, `apps/mobile/src/cache/use-cached-read.ts`
  - `apps/mobile/src/app/meeting/[id].tsx`, `apps/mobile/src/app/(tabs)/saved.tsx`, `apps/mobile/src/app/_layout.tsx`
  - `apps/mobile/test/app-data.ts`

**Interfaces:**

- Consumes: `meetingMoved` (Task 10), `useCachedRead` (Task 4), `MeetingCard` (Task 6).
- Produces:
  - from `@/saved/favorites`:
    - `favoriteIds(): Promise<string[]>` (newest saved first);
    - `isFavorite(id: string): Promise<boolean>`;
    - `setFavorite(id: string, saved: boolean): Promise<void>`;
  - `detailRead(id: string)` from `@/meetings/detail-read` (moved out of the meeting route, so the Saved tab uses the same read);
  - `pruneCache(): Promise<void>` from `@/cache/prune`;
  - `<SaveButton meetingId />` from `@/ui/save-button`;
  - `ReadState`'s failed case gains `gone: boolean`, true when the server answered `meeting_not_found`.

- [ ] **Step 1: Write the failing tests.** Create `apps/mobile/test/saved.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react-native";

import { pruneCache } from "@/cache/prune";
import { readCache, writeCache } from "@/cache/store";
import { favoriteIds, setFavorite } from "@/saved/favorites";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, VOCABULARY } from "./fixtures";
import { renderApp } from "./render-app";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SURVIVOR = "9b2e4c1a-5d6f-4a7b-8c9d-0e1f2a3b4c5d";
let api: TestApi;

beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
});
afterEach(async () => {
  await api.close();
});

describe("saving a meeting", () => {
  it("saves from the meeting page and lists it on the Saved tab", async () => {
    api.reply(`/api/v1/meetings/${ID}`, { meeting: meeting() });
    renderApp(`/meeting/${ID}`);
    fireEvent.press(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Saved" })).toBeOnTheScreen();
    expect(await favoriteIds()).toEqual([ID]);
    fireEvent.press(screen.getByRole("button", { name: "Saved" }));
    expect(await screen.findByRole("button", { name: "Save" })).toBeOnTheScreen();
    expect(await favoriteIds()).toEqual([]);
  });

  it("shows saved meetings, and says how to save when there are none", async () => {
    renderApp("/saved");
    expect(await screen.findByText("Meetings you save appear here.")).toBeOnTheScreen();
  });

  it("lists a saved meeting with its time", async () => {
    await setFavorite(ID, true);
    api.reply(`/api/v1/meetings/${ID}`, { meeting: meeting() });
    renderApp("/saved");
    expect(await screen.findByRole("button", { name: /^Nooners, Mon 12:00 PM/ })).toBeOnTheScreen();
  });

  it("works offline from the saved copy, and says so", async () => {
    setNow("2026-10-05T20:00:00Z");
    await setFavorite(ID, true);
    await writeCache(`meeting:${ID}`, { meeting: meeting() });
    setNow("2026-10-06T20:00:00Z");
    await api.close();
    renderApp("/saved");
    expect(await screen.findByRole("button", { name: /^Nooners/ })).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Showing the copy saved yesterday at 3:00 PM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    api = await startApi();
  });

  it("a merged saved meeting stays saved under its new id", async () => {
    await setFavorite(ID, true);
    api.reply(`/api/v1/meetings/${ID}`, { meeting: meeting({ id: SURVIVOR }) });
    api.reply(`/api/v1/meetings/${SURVIVOR}`, { meeting: meeting({ id: SURVIVOR }) });
    renderApp("/saved");
    await screen.findByRole("button", { name: /^Nooners/ });
    expect(await favoriteIds()).toEqual([SURVIVOR]);
  });

  it("a meeting no longer listed can be removed", async () => {
    await setFavorite(ID, true);
    api.reply(
      `/api/v1/meetings/${ID}`,
      {
        error: {
          code: "meeting_not_found",
          message: "We couldn't find that meeting. It may have been removed from the meeting list.",
        },
      },
      404,
    );
    renderApp("/saved");
    expect(await screen.findByText("This meeting is no longer listed.")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Meetings you save appear here.")).toBeOnTheScreen();
    expect(await favoriteIds()).toEqual([]);
  });
});

describe("pruneCache", () => {
  it("drops old copies but keeps saved meetings'", async () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    setNow("2026-09-01T12:00:00Z");
    await setFavorite(ID, true);
    await writeCache(`meeting:${ID}`, { meeting: meeting() });
    await writeCache(`meeting:${OTHER}`, { meeting: meeting({ id: OTHER }) });
    await writeCache("online:1", { meetings: [] });
    setNow("2026-10-05T12:00:00Z");
    await writeCache("online:2", { meetings: [] });
    await pruneCache();
    expect(await readCache(`meeting:${ID}`)).not.toBeNull();
    expect(await readCache(`meeting:${OTHER}`)).toBeNull();
    expect(await readCache("online:1")).toBeNull();
    expect(await readCache("online:2")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail.** Run `pnpm --filter mobile test -- saved`. Expected: FAIL. The modules don't exist.

- [ ] **Step 3: Implement.** Append to `MIGRATIONS`:

```ts
  // Spec §8: favorites, on the phone only.
  `create table favorites (meeting_id text primary key, saved_at integer not null) strict;`,
```

and add `"favorites"` to `TABLES` in `test/app-data.ts`.

Create `apps/mobile/src/saved/favorites.ts`:

```ts
import { z } from "zod";

import { appDatabase } from "@/db/database";

const Row = z.object({ meeting_id: z.string() });

export async function favoriteIds(): Promise<string[]> {
  const db = await appDatabase();
  const rows = await db.getAllAsync(
    "select meeting_id from favorites order by saved_at desc, rowid desc",
    [],
  );
  return z
    .array(Row)
    .parse(rows)
    .map((row) => row.meeting_id);
}

export async function isFavorite(id: string): Promise<boolean> {
  const db = await appDatabase();
  return (await db.getFirstAsync("select meeting_id from favorites where meeting_id = ?", [id])) !== null;
}

export async function setFavorite(id: string, saved: boolean): Promise<void> {
  const db = await appDatabase();
  if (saved)
    await db.runAsync("insert or ignore into favorites (meeting_id, saved_at) values (?, ?)", [
      id,
      Date.now(),
    ]);
  else await db.runAsync("delete from favorites where meeting_id = ?", [id]);
}
```

In `apps/mobile/src/meetings/merged.ts`, add inside the transaction:

```ts
await db.runAsync(
  "insert or ignore into favorites (meeting_id, saved_at) select ?, saved_at from favorites where meeting_id = ?",
  [to, from],
);
await db.runAsync("delete from favorites where meeting_id = ?", [from]);
```

Create `apps/mobile/src/meetings/detail-read.ts` with the `detailRead` function from the meeting route, exported, and import it in `src/app/meeting/[id].tsx`.

In `apps/mobile/src/cache/use-cached-read.ts`, make the failed state `{ status: "failed"; message: string; gone: boolean }`, set by `setState({ status: "failed", message: failureMessage(error), gone: error instanceof ApiError && error.code === "meeting_not_found" })`.

Create `apps/mobile/src/cache/prune.ts`:

```ts
import { appDatabase } from "@/db/database";

const DAY_MS = 86_400_000;

// Decision 4: a meeting's saved copy is kept 30 days unless the meeting is saved; an online list, 7 days. (The last
// search is replaced by the next one, and the tag list and config are single rows.)
export async function pruneCache(): Promise<void> {
  const db = await appDatabase();
  const now = Date.now();
  await db.runAsync(
    "delete from cache_entries where key like 'meeting:%' and saved_at < ? and substr(key, 9) not in (select meeting_id from favorites)",
    [now - 30 * DAY_MS],
  );
  await db.runAsync("delete from cache_entries where key like 'online:%' and saved_at < ?", [
    now - 7 * DAY_MS,
  ]);
}
```

Create `apps/mobile/src/ui/save-button.tsx`:

```tsx
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { Pressable } from "react-native";

import { isFavorite, setFavorite } from "@/saved/favorites";
import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

// Favorites stay on the phone (spec §2): saving sends nothing anywhere.
export function SaveButton({ meetingId }: { meetingId: string }) {
  const colors = useColors();
  const [saved, setSaved] = useState<boolean | null>(null);
  useEffect(() => {
    void isFavorite(meetingId).then(setSaved);
  }, [meetingId]);
  if (saved === null) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={saved ? "Saved" : "Save"}
      accessibilityHint={
        saved ? "Removes it from your saved meetings" : "Keeps it on this phone, for offline use too"
      }
      accessibilityState={{ selected: saved }}
      onPress={() => {
        void setFavorite(meetingId, !saved).then(() => {
          setSaved(!saved);
        });
      }}
      style={{ minHeight: 44, minWidth: 44, flexDirection: "row", alignItems: "center", gap: 6 }}
    >
      <Ionicons name={saved ? "heart" : "heart-outline"} size={24} color={colors.accent} />
      <AppText variant="label" style={{ color: colors.accent }}>
        {saved ? "Saved" : "Save"}
      </AppText>
    </Pressable>
  );
}
```

In `MeetingInfo` (the meeting route), render `<SaveButton meetingId={meeting.id} />` under the title. Because `MeetingDetail` has already moved the favorite to the survivor, the button reads the right id.

Replace `apps/mobile/src/app/(tabs)/saved.tsx`:

```tsx
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { useCachedRead } from "@/cache/use-cached-read";
import { detailRead } from "@/meetings/detail-read";
import { meetingMoved } from "@/meetings/merged";
import { listedTime, WEEKDAYS_SHORT } from "@/meetings/schedule";
import { favoriteIds, setFavorite } from "@/saved/favorites";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { MeetingCard } from "@/ui/meeting-card";
import { SavedCopyNote } from "@/ui/saved-copy-note";
import { Screen } from "@/ui/screen";

function SavedRow({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { state } = useCachedRead(detailRead(id));
  useEffect(() => {
    if (state.status !== "ready" || state.data.meeting.id === id) return;
    void meetingMoved(id, state.data.meeting.id).then(onChanged);
  }, [state, id, onChanged]);
  if (state.status === "loading") return <ActivityIndicator accessibilityLabel="Loading a saved meeting" />;
  if (state.status === "failed") {
    return (
      <View style={{ gap: 8 }}>
        <AppText>{state.gone ? "This meeting is no longer listed." : state.message}</AppText>
        {state.gone && (
          <Button
            kind="secondary"
            label="Remove"
            onPress={() => void setFavorite(id, false).then(onChanged)}
          />
        )}
      </View>
    );
  }
  const { meeting } = state.data;
  return (
    <View style={{ gap: 8 }}>
      {state.savedAt !== null && <SavedCopyNote savedAt={state.savedAt} />}
      <MeetingCard
        meeting={meeting}
        when={`${WEEKDAYS_SHORT[meeting.day] ?? ""} ${listedTime(meeting.time)}`}
      />
    </View>
  );
}

export default function SavedScreen() {
  const [ids, setIds] = useState<string[] | null>(null);
  const reload = useCallback(() => {
    void favoriteIds().then(setIds);
  }, []);
  useFocusEffect(reload);
  if (ids === null) return <ActivityIndicator accessibilityLabel="Loading saved meetings" />;
  if (ids.length === 0) {
    return (
      <Screen>
        <AppText>Meetings you save appear here.</AppText>
        <AppText tone="muted">
          Tap Save on a meeting's page. Saved meetings stay on this phone and work offline.
        </AppText>
      </Screen>
    );
  }
  return (
    <Screen>
      {ids.map((id) => (
        <SavedRow key={id} id={id} onChanged={reload} />
      ))}
    </Screen>
  );
}
```

In `src/app/_layout.tsx`, add `useEffect(() => { void pruneCache(); }, []);` to `RootLayout`.

- [ ] **Step 4: Run to verify they pass.** Run `pnpm --filter mobile test`. Expected: PASS. Task 5's "keeps Saved and Me working while the upgrade is required" still passes: it now shows the Saved tab's empty state.

- [ ] **Step 5: Check and commit.** Run `pnpm check`, then:

```bash
git add apps/mobile
git commit -m "feat(mobile): favorites on the phone, a Saved tab that works offline, and cache pruning"
```

---

### Task 12: The Me tab: sobriety counter, help and links

The Me tab holds:

- the sobriety counter (spec §8): total days, plus years, months and days; milestones at 24 hours, 30, 60 and 90 days, 6 and 9 months, 1 year and each year after; neutral "Set a new date" wording. The date stays on the phone;
- the help lines;
- links to the website's privacy policy, support page and terms;
- the app version.

It never shows the raw app ID (owner decision 4), and this task records that in SPEC §8 and §15. 5b adds "Delete all my tags" and "Meetings I've tagged" here.

**Files:**

- Create:
  - `apps/mobile/src/sobriety/counter.ts`, `apps/mobile/src/sobriety/sobriety-date.ts`
  - `apps/mobile/src/ui/sobriety-card.tsx`
  - `apps/mobile/test/native/datetimepicker.tsx`, `apps/mobile/test/sobriety.test.ts`, `apps/mobile/test/me-tab.test.tsx`
- Modify:
  - `apps/mobile/src/db/migrations.ts`, `apps/mobile/src/app/(tabs)/me.tsx`
  - `apps/mobile/test/app-data.ts`, `apps/mobile/jest.config.js`, `apps/mobile/package.json`
  - `SPEC.md` (§8 Settings, §15)

**Interfaces:**

- Consumes: `CivilDate` (Task 6), `HelpResources` and `Button` (Task 5), `serverUrl` and `appVersion` (Tasks 3 and 5).
- Produces:
  - from `@/sobriety/counter`:
    - `soberTime(start: CivilDate, today: CivilDate): SoberTime | null`, where `SoberTime = { totalDays: number; years: number; months: number; days: number }`;
    - `milestoneToday(start, today): string | null`;
    - `nextMilestone(start, today): { label: string; date: CivilDate }`;
    - `civilDateOf(date: Date): CivilDate` (the phone's local date);
    - `dateLabel(date: CivilDate): string` ("Oct 5, 2027");
    - `breakdownLabel(time: SoberTime): string`;
  - from `@/sobriety/sobriety-date`: `readSobrietyDate(): Promise<CivilDate | null>`, `saveSobrietyDate(date: CivilDate): Promise<void>` and `clearSobrietyDate(): Promise<void>`.

- [ ] **Step 1: Write the failing counter tests.** Create `apps/mobile/test/sobriety.test.ts`:

```ts
import { breakdownLabel, milestoneToday, nextMilestone, soberTime } from "@/sobriety/counter";

const date = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
};

describe("soberTime", () => {
  it.each([
    ["2025-10-05", "2025-10-05", { totalDays: 0, years: 0, months: 0, days: 0 }],
    ["2025-10-05", "2026-10-04", { totalDays: 364, years: 0, months: 11, days: 29 }],
    ["2025-10-05", "2026-10-05", { totalDays: 365, years: 1, months: 0, days: 0 }],
    ["2024-01-31", "2024-02-29", { totalDays: 29, years: 0, months: 1, days: 0 }],
    ["2020-02-29", "2021-02-28", { totalDays: 365, years: 1, months: 0, days: 0 }],
  ])("from %s to %s is %j", (start, today, expected) => {
    expect(soberTime(date(start), date(today))).toEqual(expected);
  });

  it("has nothing to count for a date in the future", () => {
    expect(soberTime(date("2026-10-06"), date("2026-10-05"))).toBeNull();
  });

  it("reads the breakdown without zero parts", () => {
    expect(breakdownLabel({ totalDays: 412, years: 1, months: 1, days: 16 })).toBe(
      "1 year, 1 month, 16 days",
    );
    expect(breakdownLabel({ totalDays: 365, years: 1, months: 0, days: 0 })).toBe("1 year");
    expect(breakdownLabel({ totalDays: 64, years: 0, months: 2, days: 3 })).toBe("2 months, 3 days");
  });
});

describe("milestones", () => {
  it.each([
    ["2025-10-06", "24 hours"],
    ["2025-11-04", "30 days"],
    ["2025-12-04", "60 days"],
    ["2026-01-03", "90 days"],
    ["2026-04-05", "6 months"],
    ["2026-07-05", "9 months"],
    ["2026-10-05", "1 year"],
    ["2027-10-05", "2 years"],
    ["2026-10-04", null],
  ])("started 2025-10-05, %s is %s", (today, label) => {
    expect(milestoneToday(date("2025-10-05"), date(today))).toBe(label);
  });

  it("counts a leap-day start's year on Feb 28", () => {
    expect(milestoneToday(date("2020-02-29"), date("2021-02-28"))).toBe("1 year");
  });

  it.each([
    ["2025-10-05", { label: "24 hours", date: date("2025-10-06") }],
    ["2026-01-03", { label: "6 months", date: date("2026-04-05") }],
    ["2026-10-05", { label: "2 years", date: date("2027-10-05") }],
  ])("started 2025-10-05, on %s the next is %j", (today, next) => {
    expect(nextMilestone(date("2025-10-05"), date(today))).toEqual(next);
  });
});
```

- [ ] **Step 2: Run to verify they fail.** Run `pnpm --filter mobile test -- sobriety`. Expected: FAIL. The module doesn't exist.

- [ ] **Step 3: Implement the counter.** Create `apps/mobile/src/sobriety/counter.ts`:

```ts
import type { CivilDate } from "@/meetings/schedule";

export interface SoberTime {
  totalDays: number;
  years: number;
  months: number;
  days: number;
}

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const dayNumber = (date: CivilDate) => Date.UTC(date.year, date.month - 1, date.day) / DAY_MS;
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

// The phone's local calendar date.
export function civilDateOf(date: Date): CivilDate {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

function addDays(date: CivilDate, days: number): CivilDate {
  const shifted = new Date((dayNumber(date) + days) * DAY_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

// Month steps keep the day of the month, or the month's last day when it's shorter (Jan 31 + 1 month = Feb 28 or 29).
function addMonths(date: CivilDate, months: number): CivilDate {
  const total = date.month - 1 + months;
  const year = date.year + Math.floor(total / 12);
  const month = (total % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

// Spec §8: total days, plus years, months and days.
export function soberTime(start: CivilDate, today: CivilDate): SoberTime | null {
  const totalDays = dayNumber(today) - dayNumber(start);
  if (totalDays < 0) return null;
  let months = (today.year - start.year) * 12 + (today.month - start.month);
  if (dayNumber(addMonths(start, months)) > dayNumber(today)) months -= 1;
  return {
    totalDays,
    years: Math.floor(months / 12),
    months: months % 12,
    days: dayNumber(today) - dayNumber(addMonths(start, months)),
  };
}

export function breakdownLabel(time: SoberTime): string {
  const parts: string[] = [];
  if (time.years > 0) parts.push(plural(time.years, "year"));
  if (time.months > 0) parts.push(plural(time.months, "month"));
  if (time.days > 0) parts.push(plural(time.days, "day"));
  return parts.join(", ");
}

// Spec §8: 24 hours, 30/60/90 days, 6 and 9 months, 1 year, and each year after.
function milestonesUntil(start: CivilDate, lastYear: number): { label: string; date: CivilDate }[] {
  const list = [
    { label: "24 hours", date: addDays(start, 1) },
    { label: "30 days", date: addDays(start, 30) },
    { label: "60 days", date: addDays(start, 60) },
    { label: "90 days", date: addDays(start, 90) },
    { label: "6 months", date: addMonths(start, 6) },
    { label: "9 months", date: addMonths(start, 9) },
  ];
  for (let year = 1; year <= lastYear; year++)
    list.push({ label: plural(year, "year"), date: addMonths(start, 12 * year) });
  return list;
}

export function milestoneToday(start: CivilDate, today: CivilDate): string | null {
  const reached = milestonesUntil(start, today.year - start.year + 1).find(
    (m) => dayNumber(m.date) === dayNumber(today),
  );
  return reached?.label ?? null;
}

export function nextMilestone(start: CivilDate, today: CivilDate): { label: string; date: CivilDate } {
  const next = milestonesUntil(start, today.year - start.year + 2).find(
    (m) => dayNumber(m.date) > dayNumber(today),
  );
  if (next === undefined) throw new Error("unreachable: the list always runs past today");
  return next;
}

export function dateLabel(date: CivilDate): string {
  return `${MONTHS[date.month - 1] ?? ""} ${String(date.day)}, ${String(date.year)}`;
}
```

- [ ] **Step 4: Run to verify they pass.** Run `pnpm --filter mobile test -- sobriety`. Expected: PASS (20 tests).

- [ ] **Step 5: Write the failing Me tab tests.** Run `pnpm --filter mobile exec expo install @react-native-community/datetimepicker`. Create `apps/mobile/test/native/datetimepicker.tsx`:

```tsx
import { View } from "react-native";

// The picker's props land on a View, so tests fire its change event with a chosen date.
export default function DateTimePicker(props: Record<string, unknown>) {
  return <View testID="date-picker" {...props} />;
}
```

Map `"^@react-native-community/datetimepicker$": "<rootDir>/test/native/datetimepicker.tsx"` in `jest.config.js`. Create `apps/mobile/test/me-tab.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, VOCABULARY } from "./fixtures";
import { renderApp } from "./render-app";

let api: TestApi;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  setNow("2026-10-05T17:00:00Z"); // noon on the phone
  jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});
afterEach(async () => {
  await api.close();
});

async function pickDate(buttonName: string, year: number, monthIndex: number, day: number) {
  fireEvent.press(await screen.findByRole("button", { name: buttonName }));
  fireEvent(screen.getByTestId("date-picker"), "change", { type: "set" }, new Date(year, monthIndex, day));
}

describe("the sobriety counter", () => {
  it("counts from a date set on the phone, with today's milestone and the next", async () => {
    renderApp("/me");
    expect(
      await screen.findByText(
        "Keep count of your sober time. The date stays on this phone and is never sent anywhere.",
      ),
    ).toBeOnTheScreen();
    await pickDate("Set my sobriety date", 2025, 9, 5);
    expect(await screen.findByText("365 days")).toBeOnTheScreen();
    expect(screen.getByText("1 year")).toBeOnTheScreen();
    expect(screen.getByText("Today marks 1 year.")).toBeOnTheScreen();
    expect(screen.getByText("Next: 2 years on Oct 5, 2027")).toBeOnTheScreen();
  });

  it("uses neutral words to set a new date, and can remove it", async () => {
    renderApp("/me");
    await pickDate("Set my sobriety date", 2025, 9, 5);
    await pickDate("Set a new date", 2026, 9, 1);
    expect(await screen.findByText("4 days")).toBeOnTheScreen();
    expect(screen.getByText("Next: 30 days on Oct 31, 2026")).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("button", { name: "Remove the date" }));
    expect(await screen.findByRole("button", { name: "Set my sobriety date" })).toBeOnTheScreen();
  });

  it("never sends the date anywhere", async () => {
    renderApp("/me");
    await pickDate("Set my sobriety date", 2025, 9, 5);
    await screen.findByText("365 days");
    for (const request of api.requests) {
      expect(`${request.path} ${request.body} ${JSON.stringify(request.headers)}`).not.toMatch(/2025/);
    }
  });
});

describe("the rest of the Me tab", () => {
  it("links to the website's policy, support and terms, and shows the version", async () => {
    renderApp("/me");
    fireEvent.press(await screen.findByRole("button", { name: "Privacy policy" }));
    expect(Linking.openURL).toHaveBeenCalledWith("http://127.0.0.1:3197/privacy");
    fireEvent.press(screen.getByRole("button", { name: "Support" }));
    expect(Linking.openURL).toHaveBeenCalledWith("http://127.0.0.1:3197/support");
    fireEvent.press(screen.getByRole("button", { name: "Terms of use" }));
    expect(Linking.openURL).toHaveBeenCalledWith("http://127.0.0.1:3197/terms");
    expect(screen.getByText("Version 0.1.0")).toBeOnTheScreen();
  });

  it("shows the help lines, and never the app's ID", async () => {
    renderApp("/me");
    expect(await screen.findByText("988 Suicide & Crisis Lifeline")).toBeOnTheScreen();
    expect(screen.queryByText(/app ID|device ID/i)).toBeNull();
  });
});
```

- [ ] **Step 6: Run to verify they fail.** Run `pnpm --filter mobile test -- me-tab`. Expected: FAIL. The Me tab shows only its sentence.

- [ ] **Step 7: Implement.** Append to `MIGRATIONS`:

```ts
  // Personal settings, on the phone only (spec §2): the sobriety date.
  `create table settings (key text primary key, value text not null) strict;`,
```

and add `"settings"` to `TABLES` in `test/app-data.ts`.

Create `apps/mobile/src/sobriety/sobriety-date.ts`:

```ts
import { z } from "zod";

import { appDatabase } from "@/db/database";
import type { CivilDate } from "@/meetings/schedule";

const KEY = "sobriety_date";
const Stored = z.object({ value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

// Spec §2: the sobriety date never leaves the phone.
export async function readSobrietyDate(): Promise<CivilDate | null> {
  const db = await appDatabase();
  const row = await db.getFirstAsync("select value from settings where key = ?", [KEY]);
  if (row === null) return null;
  const [year, month, day] = Stored.parse(row).value.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

export async function saveSobrietyDate(date: CivilDate): Promise<void> {
  const db = await appDatabase();
  const value = `${String(date.year)}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  await db.runAsync("insert or replace into settings (key, value) values (?, ?)", [KEY, value]);
}

export async function clearSobrietyDate(): Promise<void> {
  const db = await appDatabase();
  await db.runAsync("delete from settings where key = ?", [KEY]);
}
```

Create `apps/mobile/src/ui/sobriety-card.tsx`:

```tsx
import DateTimePicker from "@react-native-community/datetimepicker";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";

import type { CivilDate } from "@/meetings/schedule";
import {
  breakdownLabel,
  civilDateOf,
  dateLabel,
  milestoneToday,
  nextMilestone,
  soberTime,
} from "@/sobriety/counter";
import { clearSobrietyDate, readSobrietyDate, saveSobrietyDate } from "@/sobriety/sobriety-date";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

// Spec §8: neutral wording. A new date is just a new date, with no "streak broken" messages.
export function SobrietyCard() {
  const [start, setStart] = useState<CivilDate | null | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    void readSobrietyDate().then(setStart);
  }, []);
  if (start === undefined) return null;

  const today = civilDateOf(new Date());
  const time = start === null ? null : soberTime(start, today);
  const picker = picking && (
    <DateTimePicker
      value={start === null ? new Date() : new Date(start.year, start.month - 1, start.day)}
      mode="date"
      display={Platform.OS === "ios" ? "inline" : "default"}
      maximumDate={new Date()}
      onChange={(event: { type: string }, chosen?: Date) => {
        setPicking(false);
        if (event.type !== "set" || chosen === undefined) return;
        const next = civilDateOf(chosen);
        void saveSobrietyDate(next).then(() => {
          setStart(next);
        });
      }}
    />
  );

  if (start === null || time === null) {
    return (
      <View style={{ gap: 12 }}>
        <AppText variant="heading" accessibilityRole="header">
          Sobriety
        </AppText>
        <AppText>
          Keep count of your sober time. The date stays on this phone and is never sent anywhere.
        </AppText>
        <Button
          label="Set my sobriety date"
          onPress={() => {
            setPicking(true);
          }}
        />
        {picker}
      </View>
    );
  }
  const reached = milestoneToday(start, today);
  const next = nextMilestone(start, today);
  const breakdown = breakdownLabel(time);
  return (
    <View style={{ gap: 12 }}>
      <AppText variant="heading" accessibilityRole="header">
        Sobriety
      </AppText>
      <AppText variant="title">{plural(time.totalDays, "day")}</AppText>
      {breakdown !== "" && time.totalDays >= 30 && <AppText>{breakdown}</AppText>}
      {reached !== null && <AppText variant="label">{`Today marks ${reached}.`}</AppText>}
      <AppText tone="muted">{`Next: ${next.label} on ${dateLabel(next.date)}`}</AppText>
      <Button
        kind="secondary"
        label="Set a new date"
        onPress={() => {
          setPicking(true);
        }}
      />
      <Button
        kind="secondary"
        label="Remove the date"
        onPress={() =>
          void clearSobrietyDate().then(() => {
            setStart(null);
          })
        }
      />
      {picker}
    </View>
  );
}
```

(The breakdown shows only from 30 days on, where it adds something: "4 days" alone doesn't need "4 days" twice.)

Replace `apps/mobile/src/app/(tabs)/me.tsx`:

```tsx
import { Linking } from "react-native";

import { appVersion } from "@/config/app-version";
import { serverUrl } from "@/config/server-url";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { HelpResources } from "@/ui/help-resources";
import { Screen } from "@/ui/screen";
import { SobrietyCard } from "@/ui/sobriety-card";

// The website's pages, which the stores also link to (spec §11).
const PAGES = [
  { label: "Privacy policy", path: "/privacy" },
  { label: "Support", path: "/support" },
  { label: "Terms of use", path: "/terms" },
] as const;

export default function MeScreen() {
  return (
    <Screen>
      <SobrietyCard />
      <HelpResources />
      <AppText variant="heading" accessibilityRole="header">
        About
      </AppText>
      {PAGES.map((page) => (
        <Button
          key={page.path}
          kind="secondary"
          label={page.label}
          onPress={() => void Linking.openURL(`${serverUrl()}${page.path}`)}
        />
      ))}
      <AppText tone="muted">{`Version ${appVersion()}`}</AppText>
    </Screen>
  );
}
```

- [ ] **Step 8: Update the spec (owner decision 4).** In `SPEC.md` §8, replace the line

`- **Settings:** show the app ID (copyable, for support), delete all my tags, privacy policy and support links, help resources.`

with

`- **Settings:** delete all my tags, privacy policy and support links, help resources. The app never shows its device ID: the server knows a phone only by a keyed hash, and support never asks for it (owner decision, 2026-09-29).`

In §15, add `- Settings never show the raw device ID (2026-09-29), matching the privacy policy and support page.`

- [ ] **Step 9: Run and commit.** Run `pnpm check`. Expected: PASS. Then:

```bash
git add apps/mobile SPEC.md pnpm-lock.yaml
git commit -m "feat(mobile): Me tab with the sobriety counter, help lines and website links; settings never show the app ID"
```

---

### Task 13: The network audit tool

Spec §14 asks for proof, with a proxy, that the only coordinates in network traffic are rounded to 2 decimals and appear only in `POST /meetings/search` bodies, and that personal data never appears at all. mitmproxy records the app's traffic as a HAR file. This tool checks that file against those rules, so the audit is a command with a pass or fail, not an eyeball review. Task 14 runs it on real captures, and 5b reruns it on both platforms with writes.

**Files:**

- Create:
  - `tools/network-audit/package.json`, `tsconfig.json`, `vitest.config.ts`
  - `tools/network-audit/src/har.ts`, `src/audit.ts`, `src/main.ts`
  - `tools/network-audit/test/audit.test.ts`, `test/main.test.ts`

**Interfaces:**

- Consumes: `MeetingSearchRequest` from `@mymeetingapp/shared`.
- Produces:
  - `Har` (zod schema and type) from `src/har.ts`;
  - `auditHar(har: Har, options: AuditOptions): AuditReport` from `src/audit.ts`, where:
    - `AuditOptions = { server: string; privateValues: string[]; searchText: string[]; exactPoints: { latitude: number; longitude: number }[] }`;
    - `AuditReport = { serverRequests: number; otherHosts: string[]; findings: { request: string; problem: string }[] }`;
  - `run(args: string[]): Promise<AuditReport>` from `src/main.ts`;
  - the script `pnpm --filter network-audit audit --har <file> --server <host> [--private <text>]… [--search-text <text>]… [--exact <lat,lng>]…`, which exits 1 on any finding.

- [ ] **Step 1: Create the package.** Create `tools/network-audit/package.json`:

```json
{
  "name": "network-audit",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "audit": "tsx src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mymeetingapp/shared": "workspace:*",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@types/node": "^24.19.0",
    "tsx": "^4.23.15",
    "vitest": "^5.0.2"
  }
}
```

Create `tools/network-audit/tsconfig.json`, the same as `tools/feed-discovery/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test", "*.ts"]
}
```

and `tools/network-audit/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { environment: "node" } });
```

Run `pnpm install`. knip's existing `tools/*` entry covers the package.

- [ ] **Step 2: Write the failing audit tests.** Create `tools/network-audit/test/audit.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { auditHar } from "../src/audit";
import type { Har } from "../src/har";

const SERVER = "mymeetingapp.vercel.app";
const OPTIONS = {
  server: SERVER,
  privateValues: ["2011-04-17"],
  searchText: ["Maryville, TN"],
  exactPoints: [{ latitude: 36.162749, longitude: -86.781602 }],
};

function entry(method: string, url: string, extra: { headers?: [string, string][]; body?: string } = {}) {
  return {
    request: {
      method,
      url,
      headers: (extra.headers ?? []).map(([name, value]) => ({ name, value })),
      ...(extra.body === undefined ? {} : { postData: { text: extra.body } }),
    },
  };
}

const har = (...entries: ReturnType<typeof entry>[]): Har => ({ log: { entries } });
const search = (body: string) => entry("POST", `https://${SERVER}/api/v1/meetings/search`, { body });
const problems = (capture: Har) => auditHar(capture, OPTIONS).findings.map((finding) => finding.problem);

describe("auditHar", () => {
  it("passes the app's five read requests, and lists other hosts for review", () => {
    const report = auditHar(
      har(
        entry("GET", `https://${SERVER}/api/v1/config`, { headers: [["accept", "application/json"]] }),
        entry("GET", `https://${SERVER}/api/v1/vocabulary`),
        entry("GET", `https://${SERVER}/api/v1/meetings/online?day=1`),
        entry("GET", `https://${SERVER}/api/v1/meetings/0f8fad5b-d9cb-469f-a165-70867728950e`),
        search('{"lat":36.16,"lng":-86.78,"radiusKm":25}'),
        entry("GET", "https://gsp-ssl.ls.apple.com/geocode?q=Maryville%2C%20TN"),
      ),
      OPTIONS,
    );
    expect(report).toEqual({ serverRequests: 5, otherHosts: ["gsp-ssl.ls.apple.com"], findings: [] });
  });

  it("flags coordinates in a URL", () => {
    expect(
      problems(
        har(entry("POST", `https://${SERVER}/api/v1/meetings/search?lat=36.16&lng=-86.78`, { body: "{}" })),
      ),
    ).toContain("isn't one of the app's read requests");
  });

  it("flags an unrounded point, and the exact coordinate in it", () => {
    const found = problems(har(search('{"lat":36.162749,"lng":-86.78,"radiusKm":25}')));
    expect(found).toContain("search body isn't exactly a rounded lat, lng and radiusKm");
    expect(found).toContain("contains an exact coordinate (36.162)");
  });

  it("flags anything extra in the search body, such as the search text", () => {
    const found = problems(har(search('{"lat":36.16,"lng":-86.78,"radiusKm":25,"query":"Maryville, TN"}')));
    expect(found).toContain("search body isn't exactly a rounded lat, lng and radiusKm");
    expect(found).toContain('contains the search-box text "Maryville, TN"');
  });

  it("flags a device header on a read", () => {
    expect(
      problems(
        har(entry("GET", `https://${SERVER}/api/v1/vocabulary`, { headers: [["X-Device-Id", "abc"]] })),
      ),
    ).toEqual(["sends the device header X-Device-Id"]);
  });

  it("flags a private value sent anywhere, even to another host", () => {
    expect(problems(har(entry("GET", "https://example.com/?d=2011-04-17")))).toEqual([
      'contains the private value "2011-04-17"',
    ]);
  });

  it("flags any other request to our server (5a makes no writes)", () => {
    expect(problems(har(entry("POST", `https://${SERVER}/api/v1/tags`, { body: "{}" })))).toEqual([
      "isn't one of the app's read requests",
    ]);
  });
});
```

- [ ] **Step 3: Run to verify they fail.** Run `pnpm --filter network-audit test`. Expected: FAIL. `../src/audit` doesn't exist.

- [ ] **Step 4: Implement the audit.** Create `tools/network-audit/src/har.ts`:

```ts
import { z } from "zod";

// The part of a HAR capture (`mitmdump --set hardump=<file>`) the audit reads.
export const Har = z.object({
  log: z.object({
    entries: z.array(
      z.object({
        request: z.object({
          method: z.string(),
          url: z.string(),
          headers: z.array(z.object({ name: z.string(), value: z.string() })),
          postData: z.object({ text: z.string().optional() }).optional(),
        }),
      }),
    ),
  }),
});
export type Har = z.infer<typeof Har>;
```

Create `tools/network-audit/src/audit.ts`:

```ts
import { MeetingSearchRequest } from "@mymeetingapp/shared";
import { z } from "zod";

import type { Har } from "./har";

export interface AuditOptions {
  // Our server's host as it appears in URLs (mymeetingapp.vercel.app, or 192.168.x.y:3000 for local web).
  server: string;
  // Never in any request to any host: the sobriety date and other personal data set as canaries (spec §2).
  privateValues: string[];
  // Typed into the search box: the phone's geocoder may send it to Apple or Google, but never to our server (spec §8).
  searchText: string[];
  // The phone's real location, set exactly in the simulator: nothing finer than 2 decimals may reach our server.
  exactPoints: { latitude: number; longitude: number }[];
}

export interface Finding {
  request: string;
  problem: string;
}

export interface AuditReport {
  serverRequests: number;
  otherHosts: string[];
  findings: Finding[];
}

type HarRequest = Har["log"]["entries"][number]["request"];

// Phase 5a's app only reads. 5b adds its write paths here, with device headers allowed on them alone.
const READS = [
  /^\/api\/v1\/config$/,
  /^\/api\/v1\/vocabulary$/,
  /^\/api\/v1\/meetings\/online\?day=[0-6]$/,
  /^\/api\/v1\/meetings\/[0-9a-f-]{36}$/,
];
const SEARCH_PATH = "/api/v1/meetings/search";
const DEVICE_HEADERS = new Set(["x-device-id", "x-platform", "x-app-version", "x-attestation"]);
// Exactly the rounded point and radius, nothing more.
const SearchBody = z.strictObject(MeetingSearchRequest.shape);

// The first three decimals of an exact coordinate, truncated and rounded, without the sign: finer than anything the
// 2-decimal rounding can produce.
function fragments(value: number): string[] {
  const abs = Math.abs(value);
  return [...new Set([(Math.trunc(abs * 1000) / 1000).toFixed(3), abs.toFixed(3)])];
}

function decoded(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function requestText(request: HarRequest): string {
  return [
    decoded(request.url),
    ...request.headers.map((h) => `${h.name}: ${h.value}`),
    request.postData?.text ?? "",
  ]
    .join("\n")
    .toLowerCase();
}

function searchBody(request: HarRequest): unknown {
  try {
    return JSON.parse(request.postData?.text ?? "");
  } catch {
    return undefined;
  }
}

export function auditHar(har: Har, options: AuditOptions): AuditReport {
  const findings: Finding[] = [];
  const otherHosts = new Set<string>();
  let serverRequests = 0;
  for (const { request } of har.log.entries) {
    const url = new URL(request.url);
    const path = `${url.pathname}${url.search}`;
    const flag = (problem: string) =>
      findings.push({ request: `${request.method} ${url.host}${path}`, problem });
    const text = requestText(request);

    for (const value of options.privateValues) {
      if (text.includes(value.toLowerCase())) flag(`contains the private value "${value}"`);
    }
    if (url.host !== options.server) {
      otherHosts.add(url.host);
      continue;
    }
    serverRequests += 1;
    for (const value of options.searchText) {
      if (text.includes(value.toLowerCase())) flag(`contains the search-box text "${value}"`);
    }
    for (const point of options.exactPoints) {
      for (const fragment of [...fragments(point.latitude), ...fragments(point.longitude)]) {
        if (text.includes(fragment)) flag(`contains an exact coordinate (${fragment})`);
      }
    }
    for (const header of request.headers) {
      if (DEVICE_HEADERS.has(header.name.toLowerCase())) flag(`sends the device header ${header.name}`);
    }
    if (request.method === "POST" && path === SEARCH_PATH) {
      if (!SearchBody.safeParse(searchBody(request)).success)
        flag("search body isn't exactly a rounded lat, lng and radiusKm");
    } else if (!(request.method === "GET" && READS.some((read) => read.test(path)))) {
      flag("isn't one of the app's read requests");
    }
  }
  return { serverRequests, otherHosts: [...otherHosts].sort(), findings };
}
```

- [ ] **Step 5: Run to verify they pass.** Run `pnpm --filter network-audit test`. Expected: PASS (7 tests).

- [ ] **Step 6: Write the failing command-line test.** Create `tools/network-audit/test/main.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { run } from "../src/main";

async function harFile(entries: unknown[]): Promise<string> {
  const file = join(await mkdtemp(join(tmpdir(), "network-audit-")), "capture.har");
  await writeFile(file, JSON.stringify({ log: { entries } }));
  return file;
}

describe("run", () => {
  it("reads a capture, checks it and prints the verdict", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const file = await harFile([
      {
        request: {
          method: "POST",
          url: "https://mymeetingapp.vercel.app/api/v1/meetings/search",
          headers: [],
          postData: { text: '{"lat":36.16,"lng":-86.78,"radiusKm":25}' },
        },
      },
    ]);
    const report = await run([
      "--har",
      file,
      "--server",
      "mymeetingapp.vercel.app",
      "--private",
      "2011-04-17",
      "--search-text",
      "Maryville, TN",
      "--exact",
      "36.162749,-86.781602",
    ]);
    expect(report.findings).toEqual([]);
    expect(log).toHaveBeenCalledWith("PASS: nothing private reached the server");
  });

  it("explains itself when the capture or server is missing", async () => {
    await expect(run(["--server", "mymeetingapp.vercel.app"])).rejects.toThrow(
      /^Usage: pnpm --filter network-audit audit/,
    );
  });

  it("refuses an --exact that isn't lat,lng", async () => {
    const file = await harFile([]);
    await expect(run(["--har", file, "--server", "x", "--exact", "36.16"])).rejects.toThrow(
      "--exact takes lat,lng: 36.16",
    );
  });
});
```

- [ ] **Step 7: Run to verify it fails, then implement.** Run `pnpm --filter network-audit test -- main`. Expected: FAIL. `../src/main` doesn't exist. Create `tools/network-audit/src/main.ts`:

```ts
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { auditHar, type AuditReport } from "./audit";
import { Har } from "./har";

const USAGE =
  "Usage: pnpm --filter network-audit audit --har <file> --server <host> [--private <text>]… [--search-text <text>]… [--exact <lat,lng>]…";

function parsePoint(text: string): { latitude: number; longitude: number } {
  const [latitude, longitude, extra] = text.split(",").map(Number);
  if (
    latitude === undefined ||
    longitude === undefined ||
    extra !== undefined ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    throw new Error(`--exact takes lat,lng: ${text}`);
  }
  return { latitude, longitude };
}

export async function run(args: string[]): Promise<AuditReport> {
  const { values } = parseArgs({
    args,
    options: {
      har: { type: "string" },
      server: { type: "string" },
      private: { type: "string", multiple: true, default: [] },
      "search-text": { type: "string", multiple: true, default: [] },
      exact: { type: "string", multiple: true, default: [] },
    },
  });
  if (values.har === undefined || values.server === undefined) throw new Error(USAGE);
  const har = Har.parse(JSON.parse(await readFile(values.har, "utf8")));
  const report = auditHar(har, {
    server: values.server,
    privateValues: values.private,
    searchText: values["search-text"],
    exactPoints: values.exact.map(parsePoint),
  });
  console.log(
    `${String(report.serverRequests)} requests to ${values.server}; other hosts: ${report.otherHosts.join(", ") || "none"}`,
  );
  for (const finding of report.findings) console.log(`FAIL ${finding.request}: ${finding.problem}`);
  console.log(
    report.findings.length === 0
      ? "PASS: nothing private reached the server"
      : `${String(report.findings.length)} problem(s) found`,
  );
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const report = await run(process.argv.slice(2));
  process.exitCode = report.findings.length === 0 ? 0 : 1;
}
```

Run `pnpm --filter network-audit test`. Expected: PASS (10 tests).

- [ ] **Step 8: Check and commit.** Run `pnpm check` and `pnpm knip:production`. Then:

```bash
git add tools/network-audit pnpm-lock.yaml
git commit -m "feat(tools): network audit that checks a proxy capture against the privacy rules"
```

---

### Task 14: Dev builds on the iPhone, the accessibility pass, the audit and the smoke test (with the owner)

This task runs the app for real: an EAS dev build on the owner's iPhone, the iOS simulator, and an Android emulator for a first look. It checks every screen with VoiceOver and the largest text size, and captures real traffic through mitmproxy for Task 13's audit. The runbook goes in `docs/mobile.md`, so 5b and later releases repeat it. Nothing here touches production data: the app only reads the public API (owner decision 3).

**Files:**

- Create: `apps/mobile/eas.json`
- Modify: `apps/mobile/app.config.ts` (EAS project ID and owner), `docs/mobile.md`, `docs/superpowers/plans/2026-09-26-roadmap.md`

- [ ] **Step 1: End-of-phase checks.** Run `pnpm check`, `pnpm knip:production` and `pnpm --filter web test:e2e`. Expected: all pass.
  - If `knip:production` reports an export used only by tests, make it module-private, or delete it if nothing in the app uses it.
  - Run `pnpm --filter mobile exec expo install --check`. Expected: "Dependencies are up to date".
  - Run `pnpm --filter mobile exec expo-doctor`. Expected: no failed checks. A warning about the local module's missing `README` can be ignored.

- [ ] **Step 2: Link the EAS project (owner).**
  1. Run `pnpm dlx eas-cli@24.8.0 login` with the owner's Expo account.
  2. From `apps/mobile`, run `pnpm dlx eas-cli@24.8.0 init`. It creates the project and prints its ID. Because the config is `app.config.ts`, it asks you to add the ID by hand: add `owner: "<the Expo account name>"` and `extra: { eas: { projectId: "<the ID it printed>" } }` to the object `app.config.ts` returns.
  3. Create `apps/mobile/eas.json`:

```json
{
  "cli": { "version": ">= 24.8.0", "appVersionSource": "local" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": { "EXPO_PUBLIC_SERVER_URL": "https://mymeetingapp.vercel.app" }
    },
    "development-simulator": {
      "extends": "development",
      "ios": { "simulator": true }
    }
  }
}
```

     Release profiles and store submission are Phase 6.

4. Run `pnpm check`, then commit: `git add apps/mobile/eas.json apps/mobile/app.config.ts && git commit -m "chore(mobile): EAS project and development build profiles"`.

- [ ] **Step 3: Install the dev build on the owner's iPhone (owner).** Write these steps into `docs/mobile.md` under "Dev build on an iPhone", then follow them:
  1. **Register the iPhone:** from `apps/mobile`, run `pnpm dlx eas-cli@24.8.0 device:create`, choose "Website", and open the link it prints on the iPhone in Safari. Install the profile it offers (Settings → General → VPN & Device Management → the downloaded profile → Install). This registers the phone's UDID with the Apple Developer team.
  2. **Turn on Developer Mode** (iOS 16 and later): Settings → Privacy & Security → Developer Mode → On. The phone restarts; confirm "Turn On" after it does.
  3. **Build:** run `pnpm dlx eas-cli@24.8.0 build --profile development --platform ios`. Sign in with the Apple Developer account when asked, and let EAS create and manage the distribution certificate and an ad hoc provisioning profile that includes the registered iPhone.
  4. **Install:** when the build finishes, open its install link on the iPhone (or scan the QR code on the build page with the Camera) and tap Install. The app appears on the home screen.
  5. **Run:** on the Mac, run `pnpm --filter mobile start`, with the Mac and iPhone on the same Wi‑Fi. Open mymeetingapp on the iPhone; it lists the Mac's development server, or scan the QR code in the terminal with the Camera. The build reads `https://mymeetingapp.vercel.app` (`eas.json`); for local web, set `EXPO_PUBLIC_SERVER_URL` in `apps/mobile/.env` to the Mac's LAN address and restart `start`.
  6. **Adding a phone later** needs a new build: run step 1 for the new phone, then step 3 again.

  Also document the two alternatives:
  - **Without EAS (Xcode):** connect the iPhone by USB and run `npx expo run:ios --device` from `apps/mobile`, then choose the phone. The first time, open `apps/mobile/ios/mymeetingapp.xcworkspace` in Xcode, select the Gooder Software LLC team under Signing & Capabilities, and run again. If the phone asks, trust the developer in Settings → General → VPN & Device Management.
  - **Simulator:** `pnpm --filter mobile ios` builds and opens the dev build in the iOS simulator. Alternatively, `eas build --profile development-simulator --platform ios` and drag the downloaded `.app` onto the simulator.
  - **Android emulator (a first look; the full Android pass is 5b):** start an emulator from Android Studio, then run `pnpm --filter mobile android`. Without `GOOGLE_MAPS_ANDROID_API_KEY` the map is blank.

- [ ] **Step 4: Smoke test on the iPhone, then the simulator.** Delete the app first, so the run starts as a fresh install. Record each result in the "Smoke checklist" table in `docs/mobile.md` (date, build, device, pass or notes). Expected results:
  1. Launch: no location prompt. The Nearby tab shows the search box and "Use my location". The text is Atkinson Hyperlegible (compare the "g" and "l" with the website) in the website's colours. Switching the phone to dark appearance switches the app.
  2. With location still off, type "Maryville, TN" and tap Search. The list shows meetings near Maryville sorted by distance, in miles, with tag chips ("Welcoming 14"). This is the check for Owner decision 1, the native place lookup, on a real device.
  3. Filter pills: choose Evening; only evening meetings remain. "Clear filters" restores them.
  4. Map: the map shows Apple Maps with markers. Pan to a nearby town; "Near this map area" appears and the list follows. Tap a marker's callout; the meeting page opens.
  5. Meeting page: day and time, "your time" for a meeting in another zone, Directions (Apple Maps opens with the meeting as the destination), "What people say", types, "Listed by …". Tap Save; the heart fills.
  6. "Use my location": the When-In-Use prompt shows the purpose string from `app.config.ts`. Allow it; the list says "Near you".
  7. Online tab: "Happening now" and "Starting in the next 2 hours", in local time. "Join online" opens Zoom or the browser.
  8. Saved tab: the saved meeting is there. Turn on Airplane Mode and relaunch: Saved still shows it with the "Showing the copy saved …" note; Nearby's last search shows with the same note after its 75 minutes; Me still works. Turn Airplane Mode off.
  9. Me tab: set a sobriety date a year and a day ago. It shows 366 days (365 plus the leap day where one falls between), the breakdown and the next milestone. "Set a new date" and "Remove the date" work.
  10. Help: tap "Help" in any header. "Call 988", "Text 988" and "Call SAMHSA" open the phone and messages apps.
  11. Forced upgrade (on a local web server): run `pnpm --filter web dev` with `MIN_VERSION_IOS=9.0.0`, and point `.env` at it. Relaunch: Nearby and Online show "Please update mymeetingapp"; Saved, Me and Help still work. Remove the variable afterwards.

- [ ] **Step 5: Accessibility pass.** Record the results in `docs/mobile.md` under "Accessibility pass":
  1. **VoiceOver** (Settings → Accessibility → VoiceOver, or triple-click the side button if set up). Swipe through every screen: each tab, the search box, both buttons, filter pills (announced as "checkbox, checked" or "not checked" in the sheet), cards (name, time, distance, place, then "button"), tag chips ("Welcoming, 14 people"), Save ("Save" or "Saved"), Help, the date picker and the About links. Nothing may be silent, be announced only as "button", or read a raw slug.
  2. **Largest text:** Settings → Accessibility → Display & Text Size → Larger Text → turn on Larger Accessibility Sizes and drag to the maximum. Every screen must still read without clipped or overlapping text; pills and buttons grow and wrap.
  3. **Touch targets:** in the simulator, run Xcode → Open Developer Tool → Accessibility Inspector, choose the simulator, then Audit on each screen. Fix every "Hit area is too small" and "Dynamic Type font sizes are unsupported" finding in the component that owns it, with a failing test first where RNTL can see it (`toHaveStyle({ minHeight: 44 })`).
  4. **TalkBack** on the Android emulator: a quick pass of Nearby, a meeting page and Help. The full Android pass is 5b.

- [ ] **Step 6: Network audit on the iOS simulator** (Task 13's tool). Write these steps into `docs/mobile.md` under "Network audit", then run them:
  1. Install mitmproxy: `brew install mitmproxy` (version 11 or later). Run `mitmdump` once and stop it, to create `~/.mitmproxy/mitmproxy-ca-cert.pem`.
  2. Build a Release build for the simulator, so no development-server traffic mixes in: `cd apps/mobile && npx expo run:ios --configuration Release`. Then delete the app from the simulator; the fresh install comes in step 6.
  3. Trust the proxy's certificate in the booted simulator: `xcrun simctl keychain booted add-root-cert ~/.mitmproxy/mitmproxy-ca-cert.pem`.
  4. Set the simulator's exact location, the canary: `xcrun simctl location booted set 36.162749,-86.781602`.
  5. Route the Mac's traffic through mitmproxy (the simulator uses the Mac's proxy settings) and start recording:

     ```bash
     networksetup -setwebproxy "Wi-Fi" 127.0.0.1 8080
     networksetup -setsecurewebproxy "Wi-Fi" 127.0.0.1 8080
     mitmdump --listen-port 8080 --set hardump="$HOME/mma-audit-5a-sim.har"
     ```

  6. Reinstall the Release build (`npx expo run:ios --configuration Release --no-build-cache` reinstalls it), then in the app:
     - type "Maryville, TN 37804" and search;
     - open the map and pan;
     - tap "Use my location" and allow;
     - open two meetings and Save one;
     - open Saved, Online and Me;
     - set the sobriety date to April 17, 2011;
     - send the app to the background and bring it back.
  7. Stop `mitmdump` with Ctrl-C; it writes the HAR file. Turn the proxy off:

     ```bash
     networksetup -setwebproxystate "Wi-Fi" off
     networksetup -setsecurewebproxystate "Wi-Fi" off
     ```

  8. Run the audit:

     ```bash
     pnpm --filter network-audit audit --har "$HOME/mma-audit-5a-sim.har" --server mymeetingapp.vercel.app \
       --private 2011-04-17 --private "Apr 17, 2011" \
       --search-text "Maryville, TN 37804" --search-text "37804" \
       --exact 36.162749,-86.781602
     ```

     Expected: `PASS: nothing private reached the server`. Every other host must be Apple's (`*.apple.com`, `*.ls.apple.com`, `*.mzstatic.com`) and nothing else. Any other host means an SDK is calling out: stop and find it before continuing.

  9. Also capture the owner's iPhone with the same steps, with these differences:
     - Set the iPhone's Wi‑Fi to use a manual proxy (Settings → Wi‑Fi → the network → Configure Proxy → Manual) at the Mac's LAN address, port 8080.
     - Start `mitmdump` with `--listen-host 0.0.0.0`.
     - Open `http://mitm.it` in Safari and install the iOS profile. Turn on full trust for it in Settings → General → About → Certificate Trust Settings.
     - Run the audit without `--exact`: the phone's true position isn't known to the digit, and the tool still refuses any search body that isn't rounded.
     - Afterwards, remove the profile and the proxy setting.
  10. Record in `docs/mobile.md` under "Audit log": date, build, device, PASS, and the other hosts seen. Then delete the HAR files (`rm "$HOME"/mma-audit-5a-*.har`).

- [ ] **Step 7: Update the roadmap.** In `docs/superpowers/plans/2026-09-26-roadmap.md`:
  - Under "Phase 5: Mobile app", add "Split into 5a (read-only app, `2026-09-29-phase-5a-mobile-app.md`) and 5b (device ID, tagging, attendance check, my-tags record, delete all my tags, suggestions, Android pass)."
  - In the acceptance table, set "Fresh install finds meetings with no account and no location permission" to "5a (API in 2)", "Only rounded coordinates…" to "2 (server), 5a (proxy audit), 5b (again with writes)", "Personal data never in network traffic" to "5a (sobriety, favorites, recent places, search text), 5b (local tag record)", and "Below-minimum app shows upgrade screen…" to "1 (`/config`), 5a (app)".

  Commit with `docs(mobile): dev builds, smoke checklist, accessibility pass and network audit runbook`.

- [ ] **Step 8: Open the PR.** Push `phase-5a-mobile` and open a pull request against `main`. CI must be green, including `expo install --check`. The PR description lists the smoke, accessibility and audit results from `docs/mobile.md`.

---

## Done when

- `pnpm check`, `pnpm knip:production` and `pnpm --filter web test:e2e` pass, and CI is green.
- The dev build runs on the owner's iPhone and the iOS simulator, passing the smoke checklist and the accessibility pass (Task 14).
- Spec §14 criteria covered in 5a:
  - **A fresh install can find meetings with no account and no location permission** (Task 8 "finds a typed place on the phone…", Task 7's native place lookup, and Task 14's smoke step 2 on the iPhone with location off).
  - **With location allowed, nearby sorting works, and the only coordinates in network traffic are rounded to 2 decimals, only in `POST /meetings/search` bodies.**
    - Task 3 checks that search sends only the rounded point and refuses an unrounded one; Tasks 8 and 9 check location and map pans; Task 8 checks the exact re-sort.
    - Task 14's proxy audit checks captures from the simulator (with an exact-location canary) and the iPhone.
    - The logs and database half was checked in Phase 2.
  - **Personal data never appears in network traffic** (for 5a's personal data: the sobriety date, favorites, recent places and the search text): Task 12 "never sends the date anywhere", Task 8's check that no request carries the typed place, and the Task 14 audit. The local tag record is 5b's.
  - **An app below the minimum version shows the upgrade screen, and offline data still works** (Task 5).
- Owner decisions honoured:
  - design Direction A (Task 2 tokens and font);
  - no raw app ID (Task 12, SPEC §8 and §15);
  - the catch-up promises through one shared constant (Tasks 1 and 4);
  - merged meetings (Tasks 10 and 11).
- Still open after 5a (all in 5b):
  - device ID, write client and attestation seam;
  - attendance check;
  - tagging;
  - local tag record, edit and remove;
  - "Delete all my tags";
  - suggestions;
  - the Android dev build with Google Maps and the Android audit;
  - the remaining §14 rows.
