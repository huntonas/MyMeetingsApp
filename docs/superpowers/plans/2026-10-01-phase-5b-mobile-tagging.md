# Phase 5b: Mobile App (Tagging) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The writing half of the mymeetingapp phone app. It covers:

- the phone's own ID, sent only on writes;
- "Tag this meeting", with the tag picker, the attendance check, and every server refusal answered in plain words;
- "Edit my tags" and "Remove my tags";
- the local record of tagged meetings, shown on each meeting and in a "Meetings I've tagged" list;
- suggesting a new tag;
- "Delete all my tags";
- the Android pass;
- nightly maintenance on staging.

A proxy audit on both platforms proves that writes carry only what their contracts name, and reads still carry nothing that identifies the phone.

**Architecture:**

- **Device identity.** `src/device/write-headers.ts` is the only reader of the phone's ID.
  - On iOS it is a random UUID (from `expo-crypto`), kept in the Keychain by `expo-secure-store` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
  - On Android it is `ANDROID_ID` from `expo-application` (spec §6).
  - `writeHeaders()` parses the three headers with the shared `WriteHeaders` contract, which the server also reads. A bad ID or version therefore throws before anything is sent.
- **Writes.** `sendWrite(schema, method, path, body?)` in `@/api/client` adds the device headers. `getJson` and `postJson` stay header-free. The endpoint functions live in `@/api/writes`, one per endpoint, each landing with its first screen.
- **The local record.** Two new SQLite tables, behind `inTransaction`:
  - `my_tags` holds what the phone tagged and when;
  - `attendance_checks` holds only "near" results, per meeting occurrence.
  - Both follow merged meetings (`meetingMoved`) and are cleared by "Delete all my tags".
- **Tagging UI.** On the meeting page, below "What people say", `<YourTags>` shows the phone's own tags and the actions, and opens `<TagPanel>` inline:
  - the panel is the 26-tag vocabulary as checkbox pills, grouped by category, up to 6;
  - writes aren't optimistic: the server's answer (fresh counts) replaces the page's tags with `show()` from `useCachedRead`;
  - the counts are also written into the meeting's saved copy, keeping its age.
- **Window logic on the phone.** `src/tagging/window.ts` mirrors the server's rules from `schedule.ts`: the 36-hour window, the 7-day rule and the attendance time. The server stays the authority: its refusals are shown as it words them.
- **Ops.**
  - A GitHub Actions schedule calls staging's maintenance with a staging-only `CRON_SECRET`.
  - Staging is redeployed from `main`.
  - Android gets its Maps key as an EAS secret.
  - The Android audit uses an API 33 emulator with mitmproxy's CA installed as a system certificate, so no app code trusts user certificates.

**Tech Stack:**

- Expo SDK 57 (`expo` 57.0.26), with `expo-secure-store` ~57.0.4 and `expo-crypto` ~57.0.3 new. Both are pinned in SDK 57's `bundledNativeModules.json`; add them with `pnpm --filter mobile exec expo install`.
- `expo-application` ~57.0.3 (`getAndroidId`) and `expo-location` ~57.0.20 (the permission response's `ios.accuracy` / `android.accuracy`).
- The local module `modules/native-location` (Swift `requestTemporaryFullAccuracyAuthorization`).
- Jest 29 with `jest-expo` 57 and React Native Testing Library 14; zod 4; vitest for web, shared and the audit tool; GitHub Actions; EAS CLI 24.8.0.

**Spec:** `SPEC.md` (v2): §2, §5, §6 (device ID; attestation stays Phase 6), §7 (write endpoints, headers, error codes), §8 (meeting detail, attendance check, tagging flow, My tags, Settings), §11 (temporary full accuracy string), §12 (crons), §13, §14. Read it alongside:

- the roadmap, `docs/superpowers/plans/2026-09-26-roadmap.md` (Phase 5);
- the 5a plan's "Scope: Phase 5a and Phase 5b", `docs/superpowers/plans/2026-09-29-phase-5a-mobile-app.md`;
- the staging plan, `docs/superpowers/plans/2026-09-30-staging-and-testflight.md` (owner decision 2);
- the standards, `docs/standards.md` (binding);
- the notes carried over from 5a, `.superpowers/sdd/2026-09-29-phase-5a-mobile-app/carry-to-5b.md`.

**Depends on:** Phase 5a merged (`def0a27`), with this branch `phase-5b-mobile` made from it. The Phase 3 server endpoints are unchanged, and the app consumes them:

- `POST /api/v1/tags`: `TagSubmissionRequest` in, `TagWriteResponse` out, 201.
- `PUT /api/v1/tags/:meetingId`: `TagEditRequest` in, `TagWriteResponse` out.
- `DELETE /api/v1/tags/:meetingId`: `TagWriteResponse` out. No version check, no feature switch.
- `POST /api/v1/tags/delete-mine`: `DeleteMineResponse` (`{ deletedTags }`) out. No version check, no feature switch, works for a blocked device.
- `POST /api/v1/suggestions`: `SuggestionRequest` in, `SuggestionResponse` (`{ status: "received" }`) out, 202. The screening result is never returned.
- Every write's `meetingId` in the response is the surviving meeting after a merge.

The refusals the app must handle:

| Code                           | Raised by                                     |
| ------------------------------ | --------------------------------------------- |
| `invalid_request`              | bad headers or body                           |
| `upgrade_required`             | POST, PUT, suggestions                        |
| `attestation_failed`           | only while `REQUIRE_ATTESTATION` is on        |
| `device_blocked`               | POST, PUT, suggestions                        |
| `tags_disabled`                | a feature switch, or the meeting's opt-out    |
| `meeting_not_found`            | an unknown meeting; POST on an archived one   |
| `unknown_tag`, `too_many_tags` | the tag list                                  |
| `already_tagged`               | POST within 7 days; checked before the window |
| `window_closed`                | POST                                          |
| `rate_limited`                 | 10 new submissions or 5 suggestions a UTC day |
| `not_tagged`                   | PUT or DELETE with no row                     |
| `server_error`                 | anything unexpected                           |

Each comes with the plain-language message in `ERROR_MESSAGES`.

## Findings (with evidence)

1. **Headers.** The server reads `x-device-id`, `x-platform` and `x-app-version`, plus `x-attestation` (optional). The device ID must match `/^[A-Za-z0-9-]{16,64}$/` (`apps/web/src/server/devices/write-request.ts`). An iOS UUID (36 characters) and a 16-hex `ANDROID_ID` both pass. `WriteHeaders` lives only in that server file today; the 5a plan already said 5b moves it to `packages/shared` (Task 2).
2. **Attestation is off on staging and production** (`REQUIRE_ATTESTATION=off`), so a write without `X-Attestation` passes. The 5a plan's `attestationFor(body)` seam would be dead code until Phase 6, so it isn't added (decision 6).
3. **`expo-location` 57 already reports precision.** The permission response carries `ios.accuracy: "full" | "reduced"` and `android.accuracy: "fine" | "coarse" | "none"` (`build/Location.types.d.ts`). It has no temporary-full-accuracy call; only `EXBaseLocationRequester.m` reads `accuracyAuthorization`. The local module gains it (Task 6).
4. **Expo's runtime has no `crypto.randomUUID`.** `expo/src/winter` polyfills fetch, URL and TextDecoder, not crypto. `expo-crypto` 57's `randomUUID()` is the SDK's own way to get one.
5. **`useCachedRead` can't show a write's answer today.** A refresh of a copy inside its reuse window never reaches the server, and after the window it may get a CDN copy up to 15 minutes old. The page therefore shows the write's answer directly (`show`), and the saved copy keeps its `savedAt`, so no catch-up promise is stretched (decision 3).
6. **Test server.** `@mymeetingapp/test-server` hands its handler `(path, headers)` but not the method. `PUT` and `DELETE` on `/api/v1/tags/:id` share a path, so the handler gains the method (Task 3).
7. **The audit tool** treats every device header as a finding, allows `Content-Type` only on POST, and flags any body on a non-POST request (`tools/network-audit/src/headers.ts`, `audit.ts`). Writes need their own rules (Task 8).
8. **Crons and staging.** Vercel calls crons only on the production deployment, and staging has no `CRON_SECRET`, so `/api/cron/maintenance` refuses everyone there (staging plan finding 2). Once testers write tags, staging holds `tag_audit` rows under the 7-day promise.
   - GitHub runs `schedule` workflows only from the default branch. The maintenance workflow must therefore reach `main` before testers tag (Task 1, owner decision 1).
9. **Staging can be redeployed now.** It runs `b6da264`. `main` adds no migration since (`git diff b6da264 main -- apps/web/drizzle` is empty), only the `preview-branch.ts` guard and the `proxy.ts` noindex change, so `git push origin main:staging` is safe.
10. **The local record and reinstalls.** On iOS, a Keychain item survives deleting the app, but the app's SQLite file doesn't. A reinstalled iPhone therefore has its old ID but no local record. The server's `already_tagged` and `not_tagged` are how the app finds out (Review Focus 2).

## Owner decisions needed

Each has a recommendation, and the plan follows it so work isn't blocked. Say so if you want something different.

1. **Nightly maintenance on staging.**
   - **Recommendation:** a GitHub Actions workflow, `staging-maintenance.yml`, that runs nightly at 08:37 UTC and can also be run by hand. It calls `GET https://mymeetingapp-staging.vercel.app/api/cron/maintenance` with `Authorization: Bearer $STAGING_CRON_SECRET`.
   - The secret is new and staging-only. It is stored as the Vercel variable `CRON_SECRET` on the `staging` environment, as the GitHub secret `STAGING_CRON_SECRET`, and as `CRON_SECRET_STAGING` in `apps/web/.env.secrets`.
   - It lands in its **own small PR to `main`**, ahead of the rest of 5b, because scheduled workflows run only from the default branch. It must be merged before the first TestFlight build that can tag.
   - **Verified:** the route is a GET with a Bearer check (`assertCronRequest`, constant-time) and `maxDuration = 300`. Staging is public through its Deployment Protection Exception, so a GitHub runner can reach it. A private repo's scheduled workflows aren't paused for inactivity (that pause applies to public repos). The response is counts only.
   - **Caveat:** the same secret also opens staging's `/api/cron/sync-feeds`. The workflow never calls that route, and `docs/deploy.md` says never to call it, because it would crawl every feed a second time.
2. **The two leftover Neon branches.** `preview/phase-3-plan` and `preview/smarter-meeting-matching` are children of `main`, left from per-deployment previews.
   - **Recommendation:** delete both. As copies of production from when they were made, they may hold device-derived rows that sit outside every retention promise.
   - Task 1 Step 7 lists them and checks that no Vercel variable names their endpoints. Claude then deletes them through the Neon API on your go-ahead.
3. **Android in 5b.** The roadmap's Phase 5 ends with "dev builds on both platforms passing the MVP acceptance criteria". 5b also adds Android-only code: `ANDROID_ID`, the precise-location request and the okhttp user agent. All of it needs a device check before Phase 6 layers Play Integrity on top.
   - **Recommendation:** keep the Android pass in 5b (Task 10).
   - You create a Maps SDK for Android key in a Google Cloud project with billing, restricted to package `com.goodersoftware.mymeetingapp` and the SHA-1 fingerprints Task 10 lists. You store it as the EAS secret `GOOGLE_MAPS_ANDROID_API_KEY` and in `apps/mobile/.env`. It is never committed.
   - If the key isn't ready by Task 10, do the Android pass without the map, and move only the map check to Phase 6.
4. **The phone's ID** (spec §6). On iOS, a random UUID in the Keychain with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`: it survives reinstalling, isn't synced to iCloud Keychain, and isn't restored to another phone. On Android, `ANDROID_ID`.
   - **Recommendation:** as the spec says, and "Delete all my tags" doesn't make a new ID. A new ID would let a blocked iPhone escape its block, and on Android it isn't possible anyway.
   - **Consequence:** a new phone is a new device. Tags left from an old phone can be removed only from that phone. Otherwise they drop out of counts after 180 days, and the phone's server record goes after 13 months.
   - The support page gains a "Switching phones?" answer saying so (Task 3).
5. **Button wording.** The spec says "Tag this meeting"; the brief says "I went to this meeting — add tags".
   - **Recommendation:** "Tag this meeting", with the hint "For a meeting you went to: choose words that describe it". It matches the spec and the support page ("Why can't I tag a meeting?").
6. **What "Delete all my tags" clears on the phone.**
   - **Recommendation:** after the server confirms, the record of tagged meetings and the attendance-check results. Favorites, the sobriety date, recent places and saved meetings stay. If the server can't be reached, nothing on the phone changes.
7. **"Settings" on the website.** The privacy and support pages send people to "Settings" for "Delete all my tags". The app's settings are the **Me** tab.
   - **Recommendation:** change both pages to say "the app's Me tab" (Task 3), rather than add a Settings screen.

## Decisions this plan makes (confirm at review)

1. **The tag picker opens inline on the meeting page**, under "What people say", not as a separate screen.
   - Inline, the page holds the write's answer and shows the new counts at once, with no state passed between screens.
   - Opening and closing it changes nothing else on the page.
2. **Writes aren't optimistic.** The button shows "Sending your tags" until the server answers, then the page shows the answer's counts. On a refusal the choices stay, with the server's message.
3. **Counts after a write.**
   - The page shows the response's counts at once (spec §5: "so the app can show them without waiting on any cache").
   - The meeting's saved copy gets the same counts but keeps its `savedAt`, so no catch-up promise is stretched.
   - The search and Online lists catch up within their reuse windows, as the website promises.
   - The phone's own tags always show from the local record ("Your tags: …").
4. **No offline queue.** A write that can't reach the server says so, and the choices stay on screen to try again.
   - A queued tag could miss its 36-hour window.
   - A queue would also keep a list of meetings waiting to be sent.
5. **After a suggestion, the person sees only a thank-you:** "Thanks. We'll review it, and if it's added, it'll appear in the list for everyone."
   - The server never returns the screening's decision, so nobody can probe the screener.
   - Before sending, the text is checked on the phone with the shared `TagLabelText`.
6. **No attestation seam until Phase 6.** `writeHeaders()` sends three headers. Phase 6 adds `X-Attestation` where it can be tested.
7. **Messages are the server's.** A refusal shows `ApiError.message`, which is `ERROR_MESSAGES` in `packages/shared`. Only "unreachable" and phone-side failures have app wording, and each names what did or didn't happen ("so we can't tell whether your tags were saved").
8. **The phone mirrors the server's rules, but only to decide what to offer:**
   - "Tag this meeting" shows from the latest start until 36 hours later, computed in the meeting's own zone by `schedule.ts`, which resolves times as Postgres's `AT TIME ZONE` does;
   - it hides while the local record was confirmed in the last 7 days;
   - a meeting without a time zone can't be tagged.
9. **Attendance check.**
   - The automatic check on opening a meeting never shows a dialog of any kind. It runs only with location already allowed and precise.
   - The check offered in the tag panel may ask for permission. On iOS it then asks for temporary full accuracy; on Android, for precise location.
   - Only "near" results are kept, keyed by meeting and occurrence start, and pruned at launch once that occurrence's tagging window has closed.
   - The near radius is `min(200 m + reported accuracy, 500 m)`.
10. **The Android audit trusts mitmproxy's CA as a system certificate on an API 33 emulator** (mitmproxy's documented method). This means no network-security-config or user-CA trust ever enters the app.
11. **Write paths in the audit tool** are checked as strictly as search:
    - the exact method and path;
    - a body byte-identical to `JSON.stringify(<contract>.parse(...))`, or no body;
    - all three device headers with their shared shapes, and no `X-Attestation`;
    - one device ID per capture.

## Global Constraints

- Everything in `docs/standards.md`:
  - `pnpm check` passes on every commit; `pnpm knip:production` and `pnpm --filter web test:e2e` pass at the end of the phase.
  - Test-driven: a failing test first.
  - No dead code: each export, table, fake and config entry lands with its first consumer.
  - One way per concern: update the table row in the same change as any second way.
  - Mobile tests fake native modules only at their package boundary (`test/native/*`, mapped in `jest.config.js`), and time only through `setNow` and `test/clock.ts`.
- Spec §2: "Device IDs are stored only as a keyed hash … The raw ID is never stored or logged." The app never shows it, never logs it (`console` is banned in `apps/mobile`), and sends it only on writes.
- Spec §2: "Location for tagging: the proximity check runs on the phone. Only a boolean (`nearMeeting`) is sent."
- Spec §2: "Location permission: While Using only, requested the first time the user taps 'Use my location' or runs the proximity check. Never at launch. Never in the background."
- Spec §2: "Personal data never reaches our server: … the local record of tagged meetings …"
- Spec §5:
  - "1 to 6 tags per submission, all from the active vocabulary."
  - New submissions only "from meeting start until 36 hours later, computed in the meeting's own time zone (DST-aware) for the most recent occurrence".
  - "One confirmation per meeting per device per 7 days. A second new submission within 7 days returns `already_tagged` (the app should offer to edit instead)."
  - "Edits are allowed at any time … Deletes are allowed at any time."
  - "Users can suggest a new word (2–40 characters, 5 per device per day)."
- Spec §6: "iOS generates a random UUID stored in the Keychain with a `ThisDeviceOnly` accessibility class (survives reinstall, not synced to iCloud). Android uses `ANDROID_ID`."
- Spec §7: "Mobile headers on write requests: `X-Device-Id`, `X-Platform` (`ios` | `android`), `X-App-Version`, `X-Attestation`." Reads carry none of them.
- Spec §8:
  - "Meeting detail: … 'Tag this meeting' (enabled only in the tagging window for new submissions), and 'Edit my tags' / 'Remove my tags' whenever this device has tagged it."
  - "Attendance check: while the app is open and location permission is already granted, opening a meeting's detail during its time (15 min before start to 30 min after end, or 90 min after start if no end time) checks proximity on the phone: within 200 m, plus the location's accuracy, capped at 500 m. The result is stored locally and sent later as `nearMeeting`."
  - The tag flow's explanation, word for word: "We check you're near the meeting to stop spam. Your location never leaves your phone."
  - "On iOS, if only approximate location is on, request temporary full accuracy (needs `NSLocationTemporaryUsageDescriptionDictionary`). On Android, request precise location for this check."
  - "Tagging flow: choose up to 6 tags grouped by category."
  - "My tags (local record): … Used for the edit/remove buttons and a 'Meetings I've tagged' list. Never sent to the server."
  - "Settings: delete all my tags …"
- Website promises the app keeps word for word: the buttons "Remove my tags" and "Delete all my tags". After "Delete all my tags", "the app catches up within `CATCH_UP_MINUTES.app` minutes".
- Destructive actions ("Remove my tags", "Delete all my tags") go through `<ConfirmButton>`, never a native `Alert`.
- Accessibility: every control has a label and role, and every touch target is at least 44 × 44 points. Text scales with Dynamic Type. Results and refusals are `accessibilityRole="alert"` and announced.
- **No test tag ever reaches production.** TestFlight builds use staging (`eas.json` `testflight` profile). Dev builds use local web (`apps/mobile/.env`) or staging, never production.
- Nothing in this phase reads or changes production data. Vercel, Neon, GitHub secrets and EAS are touched only in steps marked **(Claude, with the owner's go-ahead)** or **(Owner)**. Claude never enters an Apple ID, Google account password or 2FA code.
- Each bash block runs as one command, from the repo root unless it says otherwise.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019qtuWT6wkew2g1c4qi6eKc
  ```

## Review Focus

1. **A write that times out, or whose connection drops after the server saved it.** The app must say it can't tell whether the tags were saved, and keep the choices. When the person tries again, the server answers `already_tagged`, and the app offers to save the same choices as an edit. Nothing is counted twice, and the local record ends up matching the server. Pinned in Task 4 ("says it can't tell whether the tags were saved when the server can't be reached") and Task 5 ("offers to save the choices as an edit when the server says this phone already tagged it").
2. **The local record out of step with the server.** An iPhone reinstall keeps the Keychain ID but loses the record; a backup restored onto a new phone brings the record but not the ID.
   - `already_tagged` must lead to an edit that recreates the record.
   - `not_tagged` on an edit or remove must forget the stale entry and say so, never loop.
   - Pinned in Task 5 ("forgets its record when the server holds no tags from this phone").
3. **A meeting that merged, or was removed from the listings, between reading and writing.**
   - A merged meeting: the tags land on the survivor, and the record, attendance results and saved copy follow it.
   - A removed meeting: a new submission is refused with the server's message, but "Remove my tags" still works from the page that says it's no longer listed.
   - Pinned in Task 5 ("follows a meeting that merged before the write landed", "can remove its tags from a meeting that's no longer listed") and Task 6 (`meetingMoved` moves attendance results).
4. **The window's edges, other zones and daylight-saving nights.**
   - "Tag this meeting" must appear at the listed start in the meeting's own zone and go at exactly 36 hours.
   - On the fall-back night it must wait for the later 1:30 AM; on the spring-forward night, a 2:30 AM meeting starts at 3:30 AM, as the server rules.
   - A phone clock that disagrees with the server gets the server's `window_closed` message.
   - Pinned in Task 4 (`tagging-window.test.ts`, and "offers tagging from the meeting's start until 36 hours after").
5. **"Delete all my tags" when it can't finish, or when everything else is switched off.**
   - Offline, or refused: nothing on the phone is cleared, and the message says the deletion didn't finish.
   - It still works below the minimum version, with tagging switched off and for a blocked phone.
   - A failure to clear the phone's own list after the server succeeded is said, not hidden.
   - Pinned in Task 3 ("keeps working below the minimum version and with tagging switched off", "says the deletion didn't finish when the server can't be reached") and Task 5 ("says so when the phone can't clear its own list").

---

## File structure

```
.github/workflows/staging-maintenance.yml   nightly GET of staging's maintenance (Task 1)
SPEC.md (§8, §12), docs/deploy.md, docs/mobile.md, docs/standards.md, roadmap
eslint.config.js                            device-ID packages banned outside src/device
packages/shared/src/devices.ts              + DEVICE_HEADERS, WriteHeaders (moved from the server)
packages/shared/test/devices.test.ts
packages/test-server/src/index.ts           handler also gets the method
apps/web/src/server/devices/write-request.ts   WriteHeaders and header names from shared
apps/web/src/app/(site)/privacy/page.tsx, support/page.tsx, src/content/privacy-inventory.ts
apps/web/test/db.ts                         + whileHolding (5a carry-over)
apps/web/test/delete-mine-route.test.ts, tags-route.test.ts, db-helpers.test.ts
tools/network-audit/src/audit.ts, headers.ts, main.ts, test/*.test.ts
apps/mobile/
  package.json, app.config.ts (temporary-accuracy purpose string), eas.json (EAS environments), jest.config.js
  modules/native-location/ios/NativeLocationModule.swift, index.ts   + requestTemporaryFullAccuracy
  src/device/write-headers.ts              the phone's ID and the write headers
  src/api/client.ts                        + sendWrite
  src/api/writes.ts                        deleteMine, submitTags, editTags, removeTags, suggestTag
  src/api/write-failure.ts                 a refused or failed write, in plain words
  src/tagging/my-tags.ts                   the local record (my_tags)
  src/tagging/window.ts                    tagging window, 7-day rule, attendance time
  src/tagging/new-counts.ts                a write's counts into the meeting's saved copy
  src/tagging/attendance-record.ts         near results (attendance_checks)
  src/tagging/use-attendance-check.ts      the automatic check on a meeting page
  src/location/attendance.ts               checkAttendance (the only exact-point use for tagging)
  src/ui/your-tags.tsx                     the meeting page's tag section
  src/ui/tag-panel.tsx                     the picker
  src/ui/attendance-offer.tsx              the check offered in the picker
  src/ui/suggest-tag.tsx                   suggesting a tag
  src/ui/delete-all-my-tags.tsx, src/ui/my-tagged-meetings.tsx
  src/app/meeting/[id].tsx, src/app/(tabs)/me.tsx
  src/cache/use-cached-read.ts (+ show), src/cache/prune.ts, src/cache/store.ts
  src/config/upgrade.tsx (+ useFeatures), src/meetings/vocabulary.tsx (+ useRefreshVocabulary)
  src/meetings/merged.ts, src/db/migrations.ts
  test/native/expo-secure-store.ts, expo-crypto.ts (new); expo-application.ts, expo-location.ts, native-location.ts
  test/api-server.ts, test/app-data.ts, test/setup.ts
  test/writes.test.ts, delete-all.test.tsx, tagging-window.test.ts, tag-meeting.test.tsx, edit-tags.test.tsx,
       my-tags.test.tsx, attendance.test.ts, attendance-check.test.tsx, suggest-tag.test.tsx
```

Test files by task:

| Task | Test files                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | none (an ops workflow; verified by a manual run and curl)                                                                              |
| 2    | `packages/shared/test/devices.test.ts`, web `write-request.test.ts` (existing, unchanged), audit `headers.test.ts`                     |
| 3    | `apps/mobile/test/writes.test.ts`, `apps/mobile/test/delete-all.test.tsx`, web `privacy-policy.test.tsx`, `terms-and-support.test.tsx` |
| 4    | `apps/mobile/test/tagging-window.test.ts`, `apps/mobile/test/tag-meeting.test.tsx`, `meeting-detail.test.tsx` (merge)                  |
| 5    | `apps/mobile/test/edit-tags.test.tsx`, `apps/mobile/test/my-tags.test.tsx`                                                             |
| 6    | `apps/mobile/test/attendance.test.ts`, `apps/mobile/test/attendance-check.test.tsx`, `app-shell.test.tsx`                              |
| 7    | `apps/mobile/test/suggest-tag.test.tsx`                                                                                                |
| 8    | `tools/network-audit/test/audit.test.ts`, `headers.test.ts`, `main.test.ts`                                                            |
| 9    | `apps/web/test/db-helpers.test.ts`, `apps/mobile/test/offline-cache.test.tsx`                                                          |
| 10   | `apps/mobile/test/eas-profiles.test.ts`                                                                                                |
| 11   | none (device runs)                                                                                                                     |

## Order of operations

1. **Task 1 first, on its own branch and PR to `main`:**
   - staging maintenance;
   - the secret;
   - redeploying staging;
   - a write-path smoke test against staging;
   - the Neon cleanup on the owner's go-ahead.
2. **Tasks 2–9 on `phase-5b-mobile`,** in order. Task 9 has no dependency and may run at any point.
3. **Task 10** (Android) once the owner has the Maps key, or without it (owner decision 3).
4. **Task 11:** TestFlight against staging, the smoke and accessibility passes on both platforms, the audits, then the PR.

---

### Task 1: Staging — nightly maintenance, a fresh deploy from `main`, and a write-path check

5b's TestFlight testers will write real device data to staging. Staging must therefore keep the 7-day `tag_audit` promise, and run `main`'s code, before any tagging build ships (owner decision 1). This task changes no app code, so it goes on its own branch from `main`.

**Files:**

- Create: `.github/workflows/staging-maintenance.yml`
- Modify: `docs/deploy.md` ("Staging (TestFlight backend)" → Crons, Variables; "Local secrets file"), `SPEC.md` §12

- [ ] **Step 1: Branch from `main`.** `git fetch origin && git switch -c staging-maintenance origin/main`.

- [ ] **Step 2: Write the workflow.** Create `.github/workflows/staging-maintenance.yml`:

```yaml
name: Staging maintenance

# Vercel runs crons only on the production deployment, so staging's nightly maintenance (purging the 7-day abuse-review
# log, old rate limits and suggestion links, and recounting tags) runs from here instead. The secret is staging's own
# CRON_SECRET; never call /api/cron/sync-feeds with it, which would crawl every feed a second time.
on:
  schedule:
    # 30 minutes after production's 08:07 UTC run.
    - cron: "37 8 * * *"
  workflow_dispatch:

permissions: {}

jobs:
  maintenance:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Run staging's nightly maintenance
        env:
          CRON_SECRET: ${{ secrets.STAGING_CRON_SECRET }}
        # The route allows 300 s. The response is counts only, so printing it is safe.
        run: >-
          curl --fail-with-body --silent --show-error --max-time 310
          --header "Authorization: Bearer $CRON_SECRET"
          https://mymeetingapp-staging.vercel.app/api/cron/maintenance
```

- [ ] **Step 3: Docs and spec.**
  - `docs/deploy.md`, "Staging (TestFlight backend)":
    - Replace the Crons bullet with: "Feed sync never runs on staging. Nightly maintenance runs from `.github/workflows/staging-maintenance.yml` at 08:37 UTC, which can also be run by hand with `gh workflow run staging-maintenance.yml`. It sends staging's own `CRON_SECRET` (GitHub secret `STAGING_CRON_SECRET`). The same secret would open `/api/cron/sync-feeds`; never call it on staging."
    - Add `CRON_SECRET` to the Variables bullet.
    - Add `CRON_SECRET_STAGING` to the staging sentence in "Local secrets file".
  - `SPEC.md` §12, Cron bullet: append "Staging's nightly maintenance runs from a scheduled GitHub Actions workflow with a staging-only secret (owner decision, 2026-10-01)."
  - Run `pnpm check`. Commit:

```bash
git add .github/workflows/staging-maintenance.yml docs/deploy.md SPEC.md
git commit -m "ci(staging): run staging's nightly maintenance from GitHub Actions"
```

- [ ] **Step 4 (Claude, with the owner's go-ahead): the secret.** One command, from `apps/web`, so the value is never printed:

```bash
cd apps/web && SECRET="$(openssl rand -hex 32)" \
  && printf '%s' "$SECRET" | vercel env add CRON_SECRET staging --scope huntonas-projects \
  && printf '%s' "$SECRET" | gh secret set STAGING_CRON_SECRET \
  && printf 'CRON_SECRET_STAGING=%s\n' "$SECRET" >> .env.secrets && chmod 600 .env.secrets \
  && vercel env ls staging --scope huntonas-projects | grep -c CRON_SECRET
```

Expected: `1`. `gh secret list` shows `STAGING_CRON_SECRET`.

- [ ] **Step 5: PR, merge, redeploy.**
  1. Push the branch and open the PR: `gh pr create --base main --title "ci(staging): nightly maintenance on staging" --body …`. The body ends with the PR attribution line.
  2. After CI is green, the owner merges it.
  3. **(Claude, with the owner's go-ahead)** `git fetch origin && git push origin origin/main:staging`. A new deployment is also what picks up the new `CRON_SECRET`.
  4. Watch the build with `vercel inspect <url> --logs`. Expected: "Not a preview build; database branch left alone", no new migrations, then the Next build.

- [ ] **Step 6 (Claude): verify maintenance and the write path on staging.**

```bash
S=https://mymeetingapp-staging.vercel.app
curl -s -o /dev/null -w '%{http_code}\n' "$S/api/cron/maintenance"            # 401 without the secret
gh workflow run staging-maintenance.yml && sleep 5 && gh run watch "$(gh run list --workflow staging-maintenance.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
# A throwaway device: a POST naming no real meeting records the device, then delete-mine removes it again.
D="curl-check-$(openssl rand -hex 8)"; H=(-H "X-Device-Id: $D" -H "X-Platform: ios" -H "X-App-Version: 0.1.0" -H 'content-type: application/json')
curl -s "${H[@]}" -X POST "$S/api/v1/tags" -d '{"meetingId":"00000000-0000-4000-8000-000000000000","tags":["quiet"]}' | jq -c .   # meeting_not_found
curl -s "${H[@]}" -X POST "$S/api/v1/tags/delete-mine" | jq -c .                                                                 # {"deletedTags":0}
curl -s -X POST "$S/api/v1/tags/delete-mine" | jq -c .error.code                                                                 # "invalid_request" (no headers)
```

Expected: `401`, then a green run whose log shows the maintenance counts, then the three answers in the comments. Record the date and results in `docs/deploy.md` under "Checking a deployment" → staging, and commit on `phase-5b-mobile` later with Task 11's docs.

- [ ] **Step 7 (Claude, with the owner's go-ahead, owner decision 2): the leftover Neon branches.** List them with their parents and endpoints, and check that nothing on Vercel points at them:

The API base and key are the staging plan's (Task 3 Step 4): `<PROJECT_ID>` is the project ID used there. Neither value is printed.

```bash
cd apps/web && KEY="$(sed -n 's/^NEON_API_KEY=//p' .env.secrets)" && API="https://console.neon.tech/api/v2/projects/<PROJECT_ID>" \
  && curl -fsS -H "Authorization: Bearer $KEY" "$API/branches" \
  | jq -r '.branches[] | select(.name=="preview/phase-3-plan" or .name=="preview/smarter-meeting-matching") | "\(.id) \(.name) parent=\(.parent_id)"' \
  && curl -fsS -H "Authorization: Bearer $KEY" "$API/endpoints" | jq -r '.endpoints[] | "\(.id) \(.branch_id)"'
```

Expected: two branches, each with its endpoint ID.

- Check that no Vercel environment's database host names those endpoint IDs. Compare the host only, as `ep-…`, and never print a URL: `vercel env pull` the non-sensitive staging variables into a temp file, `grep -c <endpoint id>`, then delete the file. Production and Preview are Sensitive, so check them by their branch IDs in `docs/deploy.md`.
- Delete each branch with `curl -fsS -X DELETE -H "Authorization: Bearer $KEY" "$API/branches/<id>"`.
- Record the deletion in `docs/deploy.md` under "Preview databases".

---

### Task 2: One shared contract for the write headers

The app and the server must agree on the header names and the device-ID shape (spec §7: "All input is validated with zod schemas shared with the mobile app"). `WriteHeaders` moves from the server into `packages/shared`, with the header names beside it. The server then reads them from there, and so does the audit tool's device-header rule. The web change is a refactor under the existing `write-request.test.ts`.

**Files:**

- Modify: `packages/shared/src/devices.ts`, `apps/web/src/server/devices/write-request.ts`, `tools/network-audit/src/headers.ts`
- Create: `packages/shared/test/devices.test.ts`

**Interfaces:**

- Produces (from `@mymeetingapp/shared`):
  - `DEVICE_HEADERS: { deviceId: "X-Device-Id"; platform: "X-Platform"; appVersion: "X-App-Version"; attestation: "X-Attestation" }`;
  - `WriteHeaders`, a zod object `{ deviceId: string /^[A-Za-z0-9-]{16,64}$/, platform: Platform, appVersion: SemVer, attestation?: string (1..16384) }`;
  - `type WriteHeaders`.

- [ ] **Step 1: Failing shared test.** Create `packages/shared/test/devices.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { DEVICE_HEADERS, WriteHeaders } from "../src/index";

describe("WriteHeaders", () => {
  it.each([
    ["an iOS Keychain UUID", "6F9619FF-8B86-D011-B42D-00C04FC964FF"],
    ["a 16-hex-digit ANDROID_ID", "dd96dec43fb81c97"],
  ])("accepts %s", (_kind, deviceId) => {
    expect(WriteHeaders.parse({ deviceId, platform: "ios", appVersion: "0.1.0" })).toEqual({
      deviceId,
      platform: "ios",
      appVersion: "0.1.0",
    });
  });

  it.each([
    ["shorter than 16 characters", "dd96dec43fb81c9"],
    ["with characters an ID never has", "dd96dec4 3fb81c97"],
    ["longer than 64 characters", "a".repeat(65)],
  ])("refuses an ID %s", (_why, deviceId) => {
    expect(WriteHeaders.safeParse({ deviceId, platform: "ios", appVersion: "0.1.0" }).success).toBe(false);
  });

  it("names the headers spec §7 lists", () => {
    expect(Object.values(DEVICE_HEADERS)).toEqual([
      "X-Device-Id",
      "X-Platform",
      "X-App-Version",
      "X-Attestation",
    ]);
  });
});
```

- [ ] **Step 2: Watch it fail.** `pnpm --filter @mymeetingapp/shared test devices`. Expected: FAIL, `DEVICE_HEADERS` and `WriteHeaders` aren't exported.

- [ ] **Step 3: Move the contract.** `packages/shared/src/devices.ts` becomes:

```ts
import { z } from "zod";

import { SemVer } from "./version";

export const PLATFORMS = ["ios", "android"] as const;
export const Platform = z.enum(PLATFORMS);
export type Platform = z.infer<typeof Platform>;

// Spec §7: the headers every write carries, and no read.
export const DEVICE_HEADERS = {
  deviceId: "X-Device-Id",
  platform: "X-Platform",
  appVersion: "X-App-Version",
  attestation: "X-Attestation",
} as const;

// Spec §6: iOS sends a Keychain UUID and Android its ANDROID_ID (16 hex digits).
export const WriteHeaders = z.object({
  deviceId: z.string().regex(/^[A-Za-z0-9-]{16,64}$/),
  platform: Platform,
  appVersion: SemVer,
  attestation: z.string().min(1).max(16_384).optional(),
});
export type WriteHeaders = z.infer<typeof WriteHeaders>;
```

In `apps/web/src/server/devices/write-request.ts`:

- delete the local `WriteHeaders` and its `z` import (keep `z` only if still used);
- import `DEVICE_HEADERS, WriteHeaders` from `@mymeetingapp/shared`;
- read each header as `req.headers.get(DEVICE_HEADERS.deviceId)` and so on (`Headers.get` ignores case);
- type `verifiedDevice(headers: WriteHeaders)`.

In `tools/network-audit/src/headers.ts`, replace the hand-written set with:

```ts
const DEVICE_HEADER_NAMES = new Set(Object.values(DEVICE_HEADERS).map((name) => name.toLowerCase()));
```

Import `DEVICE_HEADERS` from `@mymeetingapp/shared`, and rename its one use.

- [ ] **Step 4: Run everything that reads the headers.**

```bash
pnpm --filter @mymeetingapp/shared test devices && pnpm --filter web exec vitest run write-request tags-route tag-edit-routes delete-mine-route suggestions-route && pnpm --filter network-audit test
```

Expected: PASS, with the web suites unchanged.

- [ ] **Step 5: Commit.** Run `pnpm check`, then:

```bash
git add packages/shared apps/web/src/server/devices/write-request.ts tools/network-audit/src/headers.ts
git commit -m "refactor(shared): the write headers' names and shapes live in the shared contract"
```

---

### Task 3: The phone's ID, the write client and "Delete all my tags"

The app's first write is the simplest: `POST /api/v1/tags/delete-mine`, which takes no body and works for every app version and every feature switch. It brings in the device ID, the write client and the Me tab's "Delete all my tags", and the website's wording about the ID follows in the same change.

**Files:**

- Create:
  - `apps/mobile/src/device/write-headers.ts`, `apps/mobile/src/api/writes.ts`, `apps/mobile/src/api/write-failure.ts`, `apps/mobile/src/ui/delete-all-my-tags.tsx`
  - `apps/mobile/test/native/expo-secure-store.ts`, `apps/mobile/test/native/expo-crypto.ts`
  - `apps/mobile/test/writes.test.ts`, `apps/mobile/test/delete-all.test.tsx`
- Modify:
  - `apps/mobile/src/api/client.ts`, `apps/mobile/src/app/(tabs)/me.tsx`, `apps/mobile/package.json`, `apps/mobile/jest.config.js`
  - `apps/mobile/test/native/expo-application.ts`, `apps/mobile/test/setup.ts`, `apps/mobile/test/api-server.ts`
  - `packages/test-server/src/index.ts`, `eslint.config.js`, `docs/standards.md`
  - `apps/web/src/content/privacy-inventory.ts`, `apps/web/src/app/(site)/privacy/page.tsx`, `apps/web/src/app/(site)/support/page.tsx`
  - `apps/web/test/privacy-policy.test.tsx`, `apps/web/test/terms-and-support.test.tsx`

**Interfaces:**

- Consumes: `DEVICE_HEADERS`, `WriteHeaders` (Task 2); `DeleteMineResponse`, `CATCH_UP_MINUTES` from shared; `ConfirmButton`; `appPlatform`, `installedVersion` from `@/config/app-version`.
- Produces:
  - `writeHeaders(): Promise<Record<string, string>>` from `@/device/write-headers`;
  - `sendWrite<S extends z.ZodType>(schema: S, method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<z.output<S>>` from `@/api/client`;
  - `deleteMine(): Promise<DeleteMineResponse>` from `@/api/writes`;
  - `writeFailure(error: unknown, offline: string): string` from `@/api/write-failure`;
  - `<DeleteAllMyTags />` from `@/ui/delete-all-my-tags`;
  - test helpers:
    - `TestApi.reply(path, json, status?, method?)`, where a reply given a method answers only that method;
    - `keychainItem(key)`, `setKeychainItem(key, value)`, `keychainWrites()`, `setKeychainTrouble("none" | "fails")`, `resetSecureStore()`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` from `test/native/expo-secure-store`;
    - `setAndroidId(id)` from `test/native/expo-application`.

- [ ] **Step 1: Add the packages and fakes.**
  - Run `pnpm --filter mobile exec expo install expo-secure-store expo-crypto`. Expected: `expo-secure-store ~57.0.4` and `expo-crypto ~57.0.3` in `package.json`.
  - Neither needs a config plugin entry: secure-store's plugin only adds a Face ID string, which the app never uses.
  - Map the fakes in `jest.config.js`, before `^@/`:

```js
    "^expo-secure-store$": "<rootDir>/test/native/expo-secure-store.ts",
    "^expo-crypto$": "<rootDir>/test/native/expo-crypto.ts",
```

Create `apps/mobile/test/native/expo-secure-store.ts`:

```ts
// The iOS Keychain, as expo-secure-store gives it to the app: what was saved, with the options it was saved with.
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 5;

const items = new Map<string, { value: string; options: unknown }>();
let writes = 0;
// "fails": the Keychain can't be read or written (a device error), as opposed to holding nothing.
let trouble: "none" | "fails" = "none";

export function getItemAsync(key: string): Promise<string | null> {
  if (trouble === "fails") return Promise.reject(new Error("Keychain unavailable"));
  return Promise.resolve(items.get(key)?.value ?? null);
}

export function setItemAsync(key: string, value: string, options?: unknown): Promise<void> {
  if (trouble === "fails") return Promise.reject(new Error("Keychain unavailable"));
  writes += 1;
  items.set(key, { value, options });
  return Promise.resolve();
}

export const keychainItem = (key: string) => items.get(key);
export const keychainWrites = () => writes;
export function setKeychainItem(key: string, value: string): void {
  items.set(key, { value, options: { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY } });
}
export function setKeychainTrouble(next: typeof trouble): void {
  trouble = next;
}
export function resetSecureStore(): void {
  items.clear();
  writes = 0;
  trouble = "none";
}
```

Create `apps/mobile/test/native/expo-crypto.ts`:

```ts
import { randomUUID as nodeRandomUUID } from "node:crypto";

// expo-crypto's randomUUID: a version 4 UUID from the platform's secure random source.
export function randomUUID(): string {
  return nodeRandomUUID();
}
```

Add to `apps/mobile/test/native/expo-application.ts`:

```ts
// ANDROID_ID, as Android reports it for this app (16 hex digits). Tests change it with setAndroidId.
const ANDROID_ID = "dd96dec43fb81c97";
let androidId = ANDROID_ID;
export function getAndroidId(): string {
  return androidId;
}
export function setAndroidId(next: string = ANDROID_ID): void {
  androidId = next;
}
```

In `test/setup.ts`'s `beforeEach`, add `resetSecureStore();` and `setAndroidId();`.

In `packages/test-server/src/index.ts`, pass the method to the handler: the type becomes `(path: string, headers: IncomingHttpHeaders, method: string) => Reply | Promise<Reply>`, and the call `handler(path, req.headers, record.method)`. In `apps/mobile/test/api-server.ts`:

```ts
  // A reply given a method answers only that method on the path (PUT and DELETE share /api/v1/tags/:id).
  reply(path: string, json: unknown, status?: number, method?: string): void;
```

with `replies.set(method === undefined ? path : `${method} ${path}`, { status, json })`, and the lookup `const reply = replies.get(`${method} ${path}`) ?? replies.get(path);` (the handler now receives `method`).

- [ ] **Step 2: Failing tests for the ID and the write client.** Create `apps/mobile/test/writes.test.ts`:

```ts
import { Platform } from "react-native";

import { fetchVocabulary } from "@/api/reads";
import { deleteMine } from "@/api/writes";

import { startApi, type TestApi } from "./api-server";
import { VOCABULARY } from "./fixtures";
import { setAndroidId, setAppVersion } from "./native/expo-application";
import {
  keychainItem,
  keychainWrites,
  setKeychainItem,
  setKeychainTrouble,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} from "./native/expo-secure-store";

const DELETE_MINE = "/api/v1/tags/delete-mine";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEYCHAIN_ID = "6F9619FF-8B86-D011-B42D-00C04FC964FF";

let api: TestApi;
beforeEach(async () => {
  api = await startApi();
  api.reply(DELETE_MINE, { deletedTags: 0 }, 200, "POST");
});
afterEach(async () => {
  await api.close();
});

const sentId = (n = 0) => api.requests[n]?.headers["x-device-id"];

describe("the phone's ID", () => {
  it("is made on an iPhone's first write and kept in the Keychain, readable only on this phone", async () => {
    await deleteMine();
    expect(sentId()).toMatch(UUID_V4);
    expect(keychainItem("device-id")).toEqual({
      value: sentId(),
      options: { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    });
  });

  it("is the same on every later write", async () => {
    await deleteMine();
    await deleteMine();
    expect(sentId(1)).toBe(sentId(0));
    expect(keychainWrites()).toBe(1);
  });

  it("is made once when two first writes start together", async () => {
    await Promise.all([deleteMine(), deleteMine()]);
    expect(sentId(1)).toBe(sentId(0));
    expect(keychainWrites()).toBe(1);
  });

  it("is the one already in the Keychain, as after the app is reinstalled", async () => {
    setKeychainItem("device-id", KEYCHAIN_ID);
    await deleteMine();
    expect(sentId()).toBe(KEYCHAIN_ID);
    expect(keychainWrites()).toBe(0);
  });

  it("is never replaced when the Keychain can't be read, and nothing is sent", async () => {
    setKeychainTrouble("fails");
    await expect(deleteMine()).rejects.toThrow("Keychain unavailable");
    expect(api.requests).toEqual([]);
    expect(keychainWrites()).toBe(0);
  });

  it("is ANDROID_ID on Android, and the Keychain is never touched", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    await deleteMine();
    expect(sentId()).toBe("dd96dec43fb81c97");
    expect(api.requests[0]?.headers["x-platform"]).toBe("android");
    expect(keychainItem("device-id")).toBeUndefined();
  });

  it("stops the write when ANDROID_ID isn't a usable ID", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    setAndroidId("abc");
    await expect(deleteMine()).rejects.toThrow();
    expect(api.requests).toEqual([]);
  });

  it("stops the write when the app's own version can't be read", async () => {
    setAppVersion(null);
    await expect(deleteMine()).rejects.toThrow();
    expect(api.requests).toEqual([]);
  });
});

describe("writes", () => {
  it("carry the three device headers, no attestation yet, and no body when there's nothing to send", async () => {
    expect(await deleteMine()).toEqual({ deletedTags: 0 });
    const [request] = api.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe(DELETE_MINE);
    expect(request?.body).toBe("");
    expect(request?.headers["content-type"]).toBeUndefined();
    expect(request?.headers["x-platform"]).toBe("ios");
    expect(request?.headers["x-app-version"]).toBe("0.1.0");
    expect(request?.headers["x-attestation"]).toBeUndefined();
  });

  it("send no cookies", async () => {
    const spy = jest.spyOn(globalThis, "fetch");
    await deleteMine();
    expect(spy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "POST", credentials: "omit" }),
    );
  });

  it("turn the server's refusal into its plain message", async () => {
    api.reply(
      DELETE_MINE,
      {
        error: { code: "attestation_failed", message: "We couldn't confirm this request came from the app." },
      },
      403,
      "POST",
    );
    await expect(deleteMine()).rejects.toMatchObject({
      code: "attestation_failed",
      message: "We couldn't confirm this request came from the app.",
    });
  });

  it("leave later reads without any device header", async () => {
    api.reply("/api/v1/vocabulary", VOCABULARY);
    await deleteMine();
    await fetchVocabulary();
    const read = api.requests[1];
    for (const header of ["x-device-id", "x-platform", "x-app-version", "x-attestation"]) {
      expect(read?.headers[header]).toBeUndefined();
    }
  });
});
```

- [ ] **Step 3: Watch them fail.** `pnpm --filter mobile test writes`. Expected: FAIL, `Cannot find module '@/api/writes'`.

- [ ] **Step 4: The ID and the write client.** Create `apps/mobile/src/device/write-headers.ts`:

```ts
import { DEVICE_HEADERS, WriteHeaders } from "@mymeetingapp/shared";
import { getAndroidId } from "expo-application";
import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import { appPlatform, installedVersion } from "@/config/app-version";

// Spec §6: on iOS, a random UUID in the Keychain, readable only on this iPhone while it's unlocked. It is never synced
// to iCloud Keychain or restored to another phone, and it survives deleting and reinstalling the app. On Android,
// ANDROID_ID, which Android makes per app-signing key, user and device, and resets on a factory reset. The app
// never shows, logs or stores it anywhere else; it travels only in a write's headers, and the server keeps only its
// keyed hash (spec §2).
const KEY = "device-id";
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// A Keychain that can't be read throws here, so a new ID is made only when none is saved (or what's saved is no ID).
async function readOrMake(): Promise<string> {
  const saved = WriteHeaders.shape.deviceId.safeParse(await SecureStore.getItemAsync(KEY, OPTIONS));
  if (saved.success) return saved.data;
  const made = randomUUID();
  await SecureStore.setItemAsync(KEY, made, OPTIONS);
  return made;
}

let reading: Promise<string> | undefined;

function deviceId(): Promise<string> {
  if (appPlatform() === "android") return Promise.resolve(getAndroidId());
  // Two first writes at once share one new ID, rather than each saving its own.
  reading ??= readOrMake().finally(() => {
    reading = undefined;
  });
  return reading;
}

// Spec §7: the headers every write carries, and only writes. Parsed with the server's own contract, so an ID or a
// version the server would refuse stops the write before anything is sent. X-Attestation joins them in Phase 6.
export async function writeHeaders(): Promise<Record<string, string>> {
  const headers = WriteHeaders.parse({
    deviceId: await deviceId(),
    platform: appPlatform(),
    appVersion: installedVersion(),
  });
  return {
    [DEVICE_HEADERS.deviceId]: headers.deviceId,
    [DEVICE_HEADERS.platform]: headers.platform,
    [DEVICE_HEADERS.appVersion]: headers.appVersion,
  };
}
```

Append to `apps/mobile/src/api/client.ts` (import `writeHeaders` from `@/device/write-headers`):

```ts
type WriteMethod = "POST" | "PUT" | "DELETE";

// Writes carry the phone's device headers (spec §7) and, like reads, no cookies. A write with nothing to say (a
// deletion) sends no body and no Content-Type.
export async function sendWrite<S extends z.ZodType>(
  schema: S,
  method: WriteMethod,
  path: string,
  body?: unknown,
): Promise<z.output<S>> {
  const headers = { Accept: "application/json", ...(await writeHeaders()) };
  if (body === undefined) return request(schema, path, { method, headers });
  return request(schema, path, {
    method,
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
```

Change the comment on `getJson` to "Reads send nothing that identifies the phone: no device headers (only sendWrite adds them), no cookies."

Create `apps/mobile/src/api/writes.ts`:

```ts
import { DeleteMineResponse } from "@mymeetingapp/shared";

import { sendWrite } from "@/api/client";

// Spec §7: every tag, suggestion still linked, rate-limit, audit and attestation row for this phone. It has no body,
// and works below the minimum version and with tagging switched off.
export const deleteMine = () => sendWrite(DeleteMineResponse, "POST", "/api/v1/tags/delete-mine");
```

- [ ] **Step 5: Run.** `pnpm --filter mobile test writes api-client`. Expected: PASS.

- [ ] **Step 6: Lint the one way.** In `eslint.config.js`, add beside `LOCATION_IMPORTS`:

```js
const DEVICE_ID_IMPORTS = [
  { name: "expo-secure-store", message: "Use writeHeaders() from @/device/write-headers." },
  { name: "expo-crypto", message: "Use writeHeaders() from @/device/write-headers." },
  {
    name: "expo-application",
    importNames: ["getAndroidId"],
    message: "Use writeHeaders() from @/device/write-headers.",
  },
];
```

Add `...DEVICE_ID_IMPORTS` to the mobile block's `paths`, and to the `database.ts` and `src/location/**` exemption blocks, which restate the bans they don't lift. Then add:

```js
  {
    // The one place allowed to read the phone's ID.
    files: ["apps/mobile/src/device/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [SQLITE_IMPORT, ...LOCATION_IMPORTS], patterns: [PARENT_IMPORT] },
      ],
    },
  },
```

Run `pnpm lint`. Expected: clean.

- [ ] **Step 7: Failing screen tests for "Delete all my tags".** Create `apps/mobile/test/delete-all.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { CONFIG, VOCABULARY } from "./fixtures";
import { setAppVersion } from "./native/expo-application";
import { launchReadsLanded, renderApp } from "./render-app";

const DELETE_MINE = "/api/v1/tags/delete-mine";
const QUESTION = "Delete every tag this phone has added, on every meeting? This can't be undone.";

let api: TestApi;
let announce: jest.SpyInstance;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});
afterEach(async () => {
  await api.close();
});

const deletions = () => api.requests.filter((r) => r.path === DELETE_MINE);

async function deleteAll() {
  await renderApp("/me");
  await launchReadsLanded();
  await fireEvent.press(screen.getByRole("button", { name: "Delete all my tags" }));
  expect(screen.getByText(QUESTION)).toBeOnTheScreen();
  expect(announce).toHaveBeenCalledWith(QUESTION);
  await fireEvent.press(screen.getByRole("button", { name: "Delete all my tags" }));
}

describe("Delete all my tags", () => {
  it("asks first, and keeping them sends nothing", async () => {
    await renderApp("/me");
    await launchReadsLanded();
    await fireEvent.press(screen.getByRole("button", { name: "Delete all my tags" }));
    await fireEvent.press(screen.getByRole("button", { name: "Keep them" }));
    expect(screen.getByRole("button", { name: "Delete all my tags" })).toBeOnTheScreen();
    expect(deletions()).toEqual([]);
  });

  it.each([
    [
      3,
      "Deleted your tags on 3 meetings, and everything else our server kept for this phone. Counts in the app catch up within 75 minutes.",
    ],
    [
      1,
      "Deleted your tags on 1 meeting, and everything else our server kept for this phone. Counts in the app catch up within 75 minutes.",
    ],
    [0, "Our server held no tags from this phone, and anything else it kept for this phone is deleted."],
  ])("says what the server deleted (%i tags)", async (deletedTags, message) => {
    api.reply(DELETE_MINE, { deletedTags }, 200, "POST");
    await deleteAll();
    expect(await screen.findByText(message)).toBeOnTheScreen();
    expect(deletions()).toHaveLength(1);
    expect(deletions()[0]?.headers["x-device-id"]).toBeDefined();
  });

  it("keeps working below the minimum version and with tagging switched off", async () => {
    api.reply("/api/v1/config", {
      ...CONFIG,
      minSupportedVersion: { ios: "9.0.0", android: "9.0.0" },
      features: { tagging: false, suggestions: false },
    });
    setAppVersion("0.1.0");
    api.reply(DELETE_MINE, { deletedTags: 2 }, 200, "POST");
    await deleteAll();
    expect(await screen.findByText(/^Deleted your tags on 2 meetings/)).toBeOnTheScreen();
  });

  it("says the deletion didn't finish when the server can't be reached", async () => {
    // No reply set: the test server answers 599 with no envelope, which the app treats as unreachable.
    await deleteAll();
    expect(
      await screen.findByText(
        "We couldn't reach mymeetingapp to finish deleting. Check your connection and try again.",
      ),
    ).toBeOnTheScreen();
  });

  it("shows the server's own words when it refuses", async () => {
    api.reply(
      DELETE_MINE,
      {
        error: {
          code: "server_error",
          message: "Something went wrong on our end. Please try again in a few minutes.",
        },
      },
      500,
      "POST",
    );
    await deleteAll();
    expect(
      await screen.findByText("Something went wrong on our end. Please try again in a few minutes."),
    ).toBeOnTheScreen();
  });
});
```

- [ ] **Step 8: Watch them fail.** `pnpm --filter mobile test delete-all`. Expected: FAIL, no "Delete all my tags" button.

- [ ] **Step 9: The section.** Create `apps/mobile/src/api/write-failure.ts`:

```ts
import { ApiError, Unreachable } from "@/api/client";
import { GENERIC_FAILURE } from "@/cache/use-cached-read";

// A write that didn't go through, in plain words. The server's refusals come with its own message (spec §7);
// `offline` says what the caller couldn't finish, since a timed-out write may still have reached the server.
export function writeFailure(error: unknown, offline: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Unreachable) return offline;
  return GENERIC_FAILURE;
}
```

Create `apps/mobile/src/ui/delete-all-my-tags.tsx`:

```tsx
import { CATCH_UP_MINUTES } from "@mymeetingapp/shared";
import { useState } from "react";
import { AccessibilityInfo, ActivityIndicator, View } from "react-native";

import { writeFailure } from "@/api/write-failure";
import { deleteMine } from "@/api/writes";
import { AppText } from "@/ui/app-text";
import { ConfirmButton } from "@/ui/confirm-button";

const OFFLINE = "We couldn't reach mymeetingapp to finish deleting. Check your connection and try again.";

function deleted(count: number): string {
  if (count === 0)
    return "Our server held no tags from this phone, and anything else it kept for this phone is deleted.";
  return `Deleted your tags on ${String(count)} ${count === 1 ? "meeting" : "meetings"}, and everything else our server kept for this phone. Counts in the app catch up within ${String(CATCH_UP_MINUTES.app)} minutes.`;
}

// Spec §8's "delete all my tags", in the words the website promises. It works for every app version and with tagging
// switched off, like the server route.
export function DeleteAllMyTags() {
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const finish = (message: string) => {
    setDeleting(false);
    setResult(message);
    AccessibilityInfo.announceForAccessibility(message);
  };
  return (
    <View style={{ gap: 8 }}>
      {deleting ? (
        <ActivityIndicator accessibilityLabel="Deleting your tags" />
      ) : (
        <ConfirmButton
          label="Delete all my tags"
          hint="Asks before deleting every tag this phone has added"
          question="Delete every tag this phone has added, on every meeting? This can't be undone."
          confirmLabel="Delete all my tags"
          confirmHint="Deletes them from our server now"
          cancelLabel="Keep them"
          onConfirm={() => {
            setDeleting(true);
            setResult(null);
            deleteMine().then(
              ({ deletedTags }) => {
                finish(deleted(deletedTags));
              },
              (error: unknown) => {
                finish(writeFailure(error, OFFLINE));
              },
            );
          }}
        />
      )}
      {result !== null && <AppText accessibilityRole="alert">{result}</AppText>}
    </View>
  );
}
```

In `me.tsx`, between `<SobrietyCard />` and `<HelpResources />`:

```tsx
<View style={{ gap: 8 }}>
  <AppText variant="heading" accessibilityRole="header">
    Your tags
  </AppText>
  <DeleteAllMyTags />
</View>
```

Update its comment to say these are spec §8's settings.

- [ ] **Step 10: Run.** `pnpm --filter mobile test delete-all me-tab writes`. Expected: PASS.

- [ ] **Step 11: The website says where the ID lives (failing tests first).**
  - In `apps/web/test/privacy-policy.test.tsx` add:

```tsx
it("says where the app keeps its ID for the phone, and that only writes send it", () => {
  const text = renderText(<PrivacyPage />);
  expect(text).toContain("keeps it in the iPhone's Keychain, on that phone only");
  expect(text).toContain("Android's own ID for the app");
  expect(text).toContain("never when you search or read meetings");
  expect(text).toContain("“Delete all my tags” on the app's Me tab");
});
```

- In `terms-and-support.test.tsx` add:

```tsx
it("explains that tags stay with the phone that added them", () => {
  const text = renderText(<SupportPage />);
  expect(text).toContain("Switching phones?");
  expect(text).toContain("use “Delete all my tags” on the old phone first");
});
```

- Run `pnpm --filter web exec vitest run privacy-policy terms-and-support`. Expected: FAIL on the new tests.
- Then make them pass:
  - **`privacy-inventory.ts`, devices `what`:** append " On iPhone, the app makes a random ID and keeps it in the iPhone's Keychain, on that phone only: it isn't synced to iCloud Keychain or restored to another phone, and it stays if you delete and reinstall the app. On Android, the app uses Android's own ID for the app, which a factory reset changes. The app sends it only when you add, change or remove tags, suggest a tag or use “Delete all my tags”, never when you search or read meetings."
  - **`privacy/page.tsx` and `support/page.tsx`:** change "in the app's Settings" / "in Settings" to "on the app's Me tab" (owner decision 7), so the privacy page reads "“Delete all my tags” on the app's Me tab deletes …".
  - **`support/page.tsx`:** add after "How do I remove my tags?": `<h3>Switching phones?</h3><p>Your tags stay with the phone that added them: a new phone gets a new ID, so it can't change them. If you want them gone, use “Delete all my tags” on the old phone first. Otherwise they stop counting 180 days after you added them.</p>`. The 180 comes from `RETENTION.countWindowDays`; interpolate it, never retype it.
- Run the two suites again. Expected: PASS.

- [ ] **Step 12: Standards.** In `docs/standards.md`:
  - Replace "The app's network calls"' sentence "Endpoint functions live in `@/api/reads` (5b adds writes)" with: "Reads are `getJson`/`postJson` and never carry device headers. Writes are `sendWrite(schema, method, path, body?)`, which adds `writeHeaders()`' three headers. Endpoint functions live in `@/api/reads` and `@/api/writes`, and a failed write reads as `writeFailure(error, offline)` from `@/api/write-failure`."
  - Add a row: "The phone's ID | `writeHeaders()` from `@/device/write-headers`, the only reader of `expo-secure-store`, `expo-crypto` and `getAndroidId`: a Keychain UUID (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) on iOS, `ANDROID_ID` on Android, parsed with the shared `WriteHeaders` before anything is sent. A Keychain that can't be read never mints a new ID. Never shown, logged or stored elsewhere | lint, `writes.test.ts`".
- [ ] **Step 13: Commit.** `pnpm check`, then:

```bash
git add apps/mobile packages/test-server eslint.config.js docs/standards.md apps/web pnpm-lock.yaml
git commit -m "feat(mobile): the phone's ID, the write client and Delete all my tags"
```

---

### Task 4: Tagging a meeting

"Tag this meeting" on the meeting page, open from the meeting's latest start until 36 hours later. It opens the picker inline. The send is `POST /api/v1/tags`, and its answer's counts show at once. The phone keeps its own record of what it tagged, and every refusal shows the server's words. Editing, removing, `already_tagged` and merged meetings are Task 5; the attendance check is Task 6.

**Files:**

- Create:
  - `apps/mobile/src/tagging/window.ts`, `apps/mobile/src/tagging/my-tags.ts`, `apps/mobile/src/tagging/new-counts.ts`
  - `apps/mobile/src/ui/your-tags.tsx`, `apps/mobile/src/ui/tag-panel.tsx`
  - `apps/mobile/test/tagging-window.test.ts`, `apps/mobile/test/tag-meeting.test.tsx`
- Modify:
  - `apps/mobile/src/api/writes.ts`, `apps/mobile/src/app/meeting/[id].tsx`, `apps/mobile/src/cache/use-cached-read.ts`
  - `apps/mobile/src/config/upgrade.tsx`, `apps/mobile/src/meetings/vocabulary.tsx`, `apps/mobile/src/meetings/merged.ts`, `apps/mobile/src/db/migrations.ts`
  - `apps/mobile/test/app-data.ts`, `apps/mobile/test/meeting-detail.test.tsx`
  - `docs/standards.md`, `SPEC.md` §8

**Interfaces:**

- Consumes: `sendWrite`, `writeFailure` (Task 3); `lastOccurrence`, `type Scheduled` from `@/meetings/schedule`; `useNow`; `inTransaction`, `appDatabase`; `savedCopy` from `@/cache/cached-read`; `writeCache`; `detailRead`; `Pill`, `Button`, `AppText`; `ERROR_MESSAGES`, `MAX_TAGS_PER_SUBMISSION`, `TAG_CATEGORIES`, `TagSubmissionRequest`, `TagWriteResponse` from shared.
- Produces:
  - from `@/tagging/window`:
    - `TAGGING_WINDOW_MS: number` (36 h);
    - `taggingOpen(meeting: Scheduled, now: Date): boolean`;
    - `confirmedThisWeek(confirmedAt: Date, now: Date): boolean`.
  - from `@/tagging/my-tags`:
    - `interface MyTags { meetingId: string; name: string; tags: string[]; confirmedAt: Date; updatedAt: Date }`;
    - `myTagsOn(meetingId: string): Promise<MyTags | null>`;
    - `recordSubmission(meeting: { id: string; name: string }, tags: string[], at: Date): Promise<void>`.
  - `saveNewCounts(response: TagWriteResponse): Promise<void>` from `@/tagging/new-counts`.
  - `submitTags(request: TagSubmissionRequest): Promise<TagWriteResponse>` from `@/api/writes`.
  - `useCachedRead(...)` also returns `show(update: (data: T) => T): void`.
  - `useFeatures(): AppConfigResponse["features"]` from `@/config/upgrade` (all on until the config is read).
  - `useRefreshVocabulary(): () => void` from `@/meetings/vocabulary`.
  - `<TagPanel initial onSubmit onCancel />` and `OFFLINE_TAGS` from `@/ui/tag-panel`.
  - `<YourTags meeting onAnswered />` and `tagNames(slugs: readonly string[], labels: ReadonlyMap<string, VocabularyTag>): string` from `@/ui/your-tags`.

- [ ] **Step 1: Failing window tests.** Create `apps/mobile/test/tagging-window.test.ts`:

```ts
import { confirmedThisWeek, taggingOpen } from "@/tagging/window";

// Nooners: Mondays 12:00–1:00 PM in Chicago. Monday 5 October 2026 at noon is 17:00 UTC.
const NOONERS = { day: 1, time: "12:00", endTime: "13:00", timezone: "America/Chicago" };

describe("taggingOpen (spec §5, as the server's taggingWindowOpen)", () => {
  it.each([
    ["a minute before the start", "2026-10-05T16:59:00Z", false],
    ["at the start", "2026-10-05T17:00:00Z", true],
    ["35 hours 59 minutes after", "2026-10-07T04:59:00Z", true],
    ["36 hours after", "2026-10-07T05:00:00Z", false],
  ])("%s", (_when, at, open) => {
    expect(taggingOpen(NOONERS, new Date(at))).toBe(open);
  });

  // 1 November 2026, New York: 1:30 AM happens at 05:30 UTC (EDT) and again at 06:30 UTC (EST). Postgres's AT TIME
  // ZONE, and so the server, takes the later one.
  it("opens at the later 1:30 AM on the night the clocks fall back", () => {
    const meeting = { day: 0, time: "01:30", endTime: null, timezone: "America/New_York" };
    expect(taggingOpen(meeting, new Date("2026-11-01T05:45:00Z"))).toBe(false);
    expect(taggingOpen(meeting, new Date("2026-11-01T06:30:00Z"))).toBe(true);
  });

  // 8 March 2026, New York: 2:30 AM never happens; the server moves it an hour later, to 3:30 AM EDT (07:30 UTC).
  it("opens an hour later for a time the clocks skip", () => {
    const meeting = { day: 0, time: "02:30", endTime: null, timezone: "America/New_York" };
    expect(taggingOpen(meeting, new Date("2026-03-08T07:29:00Z"))).toBe(false);
    expect(taggingOpen(meeting, new Date("2026-03-08T07:30:00Z"))).toBe(true);
  });

  it("follows the meeting's own zone, not the phone's", () => {
    const tokyo = { day: 1, time: "19:00", endTime: null, timezone: "Asia/Tokyo" };
    // Monday 7 PM in Tokyo is Monday 10:00 UTC, while the phone (Chicago) still reads Monday 5 AM.
    expect(taggingOpen(tokyo, new Date("2026-10-05T09:59:00Z"))).toBe(false);
    expect(taggingOpen(tokyo, new Date("2026-10-05T10:00:00Z"))).toBe(true);
  });
});

describe("confirmedThisWeek (spec §5's 7-day rule, as the server's)", () => {
  it.each([
    ["6 days 23 hours later", "2026-10-12T16:00:00Z", true],
    ["exactly 7 days later", "2026-10-12T17:00:00Z", false],
  ])("%s", (_when, at, within) => {
    expect(confirmedThisWeek(new Date("2026-10-05T17:00:00Z"), new Date(at))).toBe(within);
  });
});
```

- [ ] **Step 2: Watch it fail.** `pnpm --filter mobile test tagging-window`. Expected: FAIL, module not found.

- [ ] **Step 3: The window.** Create `apps/mobile/src/tagging/window.ts`:

```ts
import { lastOccurrence, type Scheduled } from "@/meetings/schedule";
import { DAY_MS, MINUTE_MS } from "@/time/civil-date";

// Spec §5: new submissions from the most recent start until 36 hours later, and one per meeting every 7 days. The
// phone decides only what to offer from these; the server's answer (window_closed, already_tagged) always wins.
export const TAGGING_WINDOW_MS = 36 * 60 * MINUTE_MS;

// lastOccurrence resolves the start in the meeting's own zone as Postgres's AT TIME ZONE does, so the window opens
// and closes at the same instants as the server's taggingWindowOpen.
export function taggingOpen(meeting: Scheduled, now: Date): boolean {
  const start = lastOccurrence(meeting, now).start.getTime();
  return now.getTime() >= start && now.getTime() < start + TAGGING_WINDOW_MS;
}

export function confirmedThisWeek(confirmedAt: Date, now: Date): boolean {
  return now.getTime() - confirmedAt.getTime() < 7 * DAY_MS;
}
```

Run `pnpm --filter mobile test tagging-window`. Expected: PASS.

- [ ] **Step 4: Failing screen tests.** Create `apps/mobile/test/tag-meeting.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { readCache } from "@/cache/store";
import { myTagsOn } from "@/tagging/my-tags";

import { startApi, type TestApi } from "./api-server";
import { resetAppData } from "./app-data";
import { setNow } from "./clock";
import { CONFIG, meeting, VOCABULARY } from "./fixtures";
import { renderApp } from "./render-app";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PATH = `/api/v1/meetings/${ID}`;
// Nooners (fixtures.ts) meets Mondays 12:00–1:00 PM in Chicago: Monday 5 October 2026 at noon is 17:00 UTC.
const STARTED = "2026-10-05T17:00:00Z";
const COUNTS = [
  { slug: "welcoming", count: 15 },
  { slug: "coffee", count: 1 },
];

let api: TestApi;
beforeEach(async () => {
  await resetAppData();
  api = await startApi();
  api.reply("/api/v1/config", CONFIG);
  api.reply("/api/v1/vocabulary", VOCABULARY);
  api.reply(PATH, { meeting: meeting() });
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});
afterEach(async () => {
  await api.close();
});

const tagWrites = () => api.requests.filter((r) => r.path === "/api/v1/tags");

async function openMeeting(at = STARTED) {
  setNow(at);
  await renderApp(`/meeting/${ID}`);
  await screen.findByLabelText("Welcoming 14 people");
}

async function choose(...labels: string[]) {
  for (const label of labels) await fireEvent.press(screen.getByRole("checkbox", { name: label }));
}

async function tag(...labels: string[]) {
  await fireEvent.press(screen.getByRole("button", { name: "Tag this meeting" }));
  await choose(...labels);
  await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
}

describe("Tag this meeting", () => {
  it.each([
    ["a minute before it starts", "2026-10-05T16:59:00Z", false],
    ["as it starts", STARTED, true],
    ["35 hours 59 minutes later", "2026-10-07T04:59:00Z", true],
    ["36 hours later", "2026-10-07T05:00:00Z", false],
  ])("is offered only from the start until 36 hours after: %s", async (_when, at, offered) => {
    await openMeeting(at);
    const button = screen.queryByRole("button", { name: "Tag this meeting" });
    if (offered) {
      expect(button).toHaveProp(
        "accessibilityHint",
        "For a meeting you went to: choose words that describe it",
      );
    } else {
      expect(button).toBeNull();
      expect(
        screen.getByText("You can add tags from the start of this meeting until 36 hours after."),
      ).toBeOnTheScreen();
    }
  });

  it("lists the tags by category and sends the chosen ones, with this phone's headers and nothing else", async () => {
    api.reply("/api/v1/tags", { meetingId: ID, tags: COUNTS }, 201, "POST");
    await openMeeting();
    await fireEvent.press(screen.getByRole("button", { name: "Tag this meeting" }));
    for (const category of ["Format", "Sharing", "Crowd", "Feel", "Practical"]) {
      expect(screen.getByRole("header", { name: category })).toBeOnTheScreen();
    }
    await choose("Welcoming", "Coffee");
    expect(screen.getByText("2 of 6 chosen")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    expect(await screen.findByText("Thanks. Your tags are added.")).toBeOnTheScreen();
    const [write] = tagWrites();
    expect(write?.method).toBe("POST");
    expect(write?.body).toBe(`{"meetingId":"${ID}","tags":["welcoming","coffee"]}`);
    expect(write?.headers["x-platform"]).toBe("ios");
    expect(write?.headers["x-app-version"]).toBe("0.1.0");
    expect(write?.headers["x-device-id"]).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("shows the server's new counts at once, and keeps them in the saved copy without making it look newer", async () => {
    api.reply("/api/v1/tags", { meetingId: ID, tags: COUNTS }, 201, "POST");
    await openMeeting();
    const before = await readCache(`meeting:${ID}`);
    await tag("Welcoming", "Coffee");
    expect(await screen.findByLabelText("Welcoming 15 people")).toBeOnTheScreen();
    expect(screen.getByLabelText("Coffee 1 person")).toBeOnTheScreen();
    await waitFor(async () => {
      expect((await readCache(`meeting:${ID}`))?.body).toEqual({ meeting: meeting({ tags: COUNTS }) });
    });
    expect((await readCache(`meeting:${ID}`))?.savedAt).toEqual(before?.savedAt);
  });

  it("keeps a record on the phone, shows it, and offers no second new tagging that week", async () => {
    api.reply("/api/v1/tags", { meetingId: ID, tags: COUNTS }, 201, "POST");
    await openMeeting();
    await tag("Welcoming", "Coffee");
    expect(await screen.findByText("Your tags: Welcoming · Coffee")).toBeOnTheScreen();
    expect(screen.getByText("Added Oct 5, 2026")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Tag this meeting" })).toBeNull();
    expect(await myTagsOn(ID)).toEqual({
      meetingId: ID,
      name: "Nooners",
      tags: ["welcoming", "coffee"],
      confirmedAt: new Date(STARTED),
      updatedAt: new Date(STARTED),
    });
  });

  it("lets at most 6 tags be chosen, and says so", async () => {
    await openMeeting();
    await fireEvent.press(screen.getByRole("button", { name: "Tag this meeting" }));
    await choose("Laid back", "Quiet", "Coffee", "Welcoming", "Lively", "Serious tone", "Runs long");
    expect(screen.getByText("6 of 6 chosen")).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Runs long" })).toHaveAccessibilityState({ checked: false });
    expect(screen.getByRole("alert")).toHaveTextContent("Choose up to 6 tags.");
  });

  it("asks for at least one tag and sends nothing without one", async () => {
    await openMeeting();
    await fireEvent.press(screen.getByRole("button", { name: "Tag this meeting" }));
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose at least one tag.");
    expect(tagWrites()).toEqual([]);
  });

  it("closes the picker on Cancel, sending nothing", async () => {
    await openMeeting();
    await fireEvent.press(screen.getByRole("button", { name: "Tag this meeting" }));
    await choose("Quiet");
    await fireEvent.press(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("checkbox", { name: "Quiet" })).toBeNull();
    expect(tagWrites()).toEqual([]);
  });

  it.each([
    [
      "the group asked not to be tagged",
      { meeting: meeting({ tagsDisabled: true, tags: [] }) },
      CONFIG,
      null,
    ],
    [
      "tagging is switched off",
      { meeting: meeting() },
      { ...CONFIG, features: { tagging: false, suggestions: true } },
      "Tagging isn't available for this right now.",
    ],
    [
      "the app is below the minimum version",
      { meeting: meeting() },
      { ...CONFIG, minSupportedVersion: { ios: "9.0.0", android: "9.0.0" } },
      "This version of the app is too old. Please update it to keep adding tags.",
    ],
    [
      "the listing has no time zone",
      { meeting: meeting({ timezone: null }) },
      CONFIG,
      "This meeting's listing doesn't give its time zone, so it can't be tagged.",
    ],
  ])("isn't offered when %s", async (_why, detail, config, message) => {
    api.reply("/api/v1/config", config);
    api.reply(PATH, detail);
    setNow(STARTED);
    await renderApp(`/meeting/${ID}`);
    await screen.findByRole("header", { name: "What people say" });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Tag this meeting" })).toBeNull();
    });
    if (message !== null) expect(await screen.findByText(message)).toBeOnTheScreen();
  });

  it.each([
    ["rate_limited", "You've reached today's limit. Please try again tomorrow."],
    ["device_blocked", "Tagging isn't available from this device."],
    ["window_closed", "New tags can be added from the start of the meeting until 36 hours after."],
    ["upgrade_required", "This version of the app is too old. Please update it to keep adding tags."],
    ["meeting_not_found", "We couldn't find that meeting. It may have been removed from the meeting list."],
    ["tags_disabled", "Tagging isn't available for this right now."],
  ])("shows the server's words for %s, keeps the choices and records nothing", async (code, message) => {
    api.reply("/api/v1/tags", { error: { code, message } }, 409, "POST");
    await openMeeting();
    await tag("Quiet");
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("checkbox", { name: "Quiet" })).toHaveAccessibilityState({ checked: true });
    expect(await myTagsOn(ID)).toBeNull();
  });

  it("says it can't tell whether the tags were saved when the server can't be reached", async () => {
    // No reply set for the POST: the test server answers 599 with no envelope.
    await openMeeting();
    await tag("Quiet");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach mymeetingapp, so we can't tell whether your tags were saved. Check your connection and try again.",
    );
    expect(await myTagsOn(ID)).toBeNull();
  });

  it("reads the tag list again after a tag was retired, and drops it from the choices", async () => {
    api.reply(
      "/api/v1/tags",
      {
        error: {
          code: "unknown_tag",
          message: "One of those tags isn't available anymore. Refresh the list and try again.",
        },
      },
      400,
      "POST",
    );
    await openMeeting();
    api.reply("/api/v1/vocabulary", { tags: VOCABULARY.tags.filter((t) => t.slug !== "coffee") });
    await tag("Quiet", "Coffee");
    expect(await screen.findByRole("alert")).toHaveTextContent("One of those tags isn't available anymore.");
    await waitFor(() => {
      expect(screen.queryByRole("checkbox", { name: "Coffee" })).toBeNull();
    });
    expect(screen.getByText("1 of 6 chosen")).toBeOnTheScreen();
  });
});
```

Also add to `meeting-detail.test.tsx`'s merged-meeting test: before rendering, `await recordSubmission({ id: ID, name: "Nooners" }, ["quiet"], new Date("2026-10-05T17:00:00Z"))`. After following the survivor: `expect(await myTagsOn(SURVIVOR)).toMatchObject({ tags: ["quiet"] })` and `expect(await myTagsOn(ID)).toBeNull()`.

- [ ] **Step 5: Watch them fail.** `pnpm --filter mobile test tag-meeting meeting-detail`. Expected: FAIL, no "Tag this meeting" button and no `@/tagging/my-tags`.

- [ ] **Step 6: The local record.** Append to `MIGRATIONS` in `src/db/migrations.ts`:

```ts
  // Spec §8: the phone's own record of what it tagged (the edit/remove buttons and "Meetings I've tagged"). Never sent.
  `create table my_tags (meeting_id text primary key, name text not null, tags text not null, confirmed_at integer not null, updated_at integer not null) strict;`,
```

Add `"my_tags"` to `TABLES` in `test/app-data.ts`. Create `src/tagging/my-tags.ts`:

```ts
import { z } from "zod";

import { appDatabase, inTransaction } from "@/db/database";

export interface MyTags {
  meetingId: string;
  // The meeting's name when it was tagged, for "Meetings I've tagged".
  name: string;
  tags: string[];
  confirmedAt: Date;
  updatedAt: Date;
}

const Row = z.object({
  meeting_id: z.string(),
  name: z.string(),
  tags: z.string(),
  confirmed_at: z.number(),
  updated_at: z.number(),
});

const Tags = z.array(z.string());

function parse(row: unknown): MyTags {
  const r = Row.parse(row);
  return {
    meetingId: r.meeting_id,
    name: r.name,
    tags: Tags.parse(JSON.parse(r.tags)),
    confirmedAt: new Date(r.confirmed_at),
    updatedAt: new Date(r.updated_at),
  };
}

// Spec §2, §8: this stays on the phone; nothing here is ever sent.
export async function myTagsOn(meetingId: string): Promise<MyTags | null> {
  const db = await appDatabase();
  const row = await db.getFirstAsync(
    "select meeting_id, name, tags, confirmed_at, updated_at from my_tags where meeting_id = ?",
    [meetingId],
  );
  return row === null ? null : parse(row);
}

// A new submission (or a re-confirmation a week or more later) the server accepted: both dates move to `at`.
export function recordSubmission(
  meeting: { id: string; name: string },
  tags: string[],
  at: Date,
): Promise<void> {
  return inTransaction(async (db) => {
    await db.runAsync(
      "insert or replace into my_tags (meeting_id, name, tags, confirmed_at, updated_at) values (?, ?, ?, ?, ?)",
      [meeting.id, meeting.name, JSON.stringify(tags), at.getTime(), at.getTime()],
    );
  });
}
```

In `src/meetings/merged.ts`, inside the same `inTransaction`, after the favorites move:

```ts
// The phone's tag record follows too; if both ids were tagged, the survivor's own record stays.
await db.runAsync(
  "insert or ignore into my_tags (meeting_id, name, tags, confirmed_at, updated_at) select ?, name, tags, confirmed_at, updated_at from my_tags where meeting_id = ?",
  [to, from],
);
await db.runAsync("delete from my_tags where meeting_id = ?", [from]);
```

- [ ] **Step 7: Features, a vocabulary refresh, and showing an answer.**
  - **`src/config/upgrade.tsx`:** add a `Features` context. `UpgradeProvider` provides `state.status === "ready" ? state.data.features : ALL_ON` (memoised), where `const ALL_ON = { tagging: true, suggestions: true }`; with no config (offline), nothing is hidden and the server still decides. Export `useFeatures()`.
  - **`src/meetings/vocabulary.tsx`:** add a second context holding `refresh`, and export `useRefreshVocabulary()`.
  - **`src/cache/use-cached-read.ts`:** add

```ts
// Shows `update(data)` in place of what's on screen, keeping how old it is (savedAt, reason): a write's answer
// changes only what it answered, such as a meeting's tag counts.
const show = useCallback((update: (data: z.output<S>) => z.output<S>) => {
  setState((current) => (current.status === "ready" ? { ...current, data: update(current.data) } : current));
}, []);
return { state, refresh, show };
```

- **`src/tagging/new-counts.ts`:**

```ts
import type { TagWriteResponse } from "@mymeetingapp/shared";

import { savedCopy } from "@/cache/cached-read";
import { writeCache } from "@/cache/store";
import { detailRead } from "@/meetings/detail-read";

// A write's answer carries the meeting's fresh counts (spec §5). They go into the meeting's saved copy, which keeps
// its savedAt: the rest of the copy is no newer than it was, so the website's catch-up promises still hold. Best
// effort, like the cache itself.
export async function saveNewCounts(response: TagWriteResponse): Promise<void> {
  const read = detailRead(response.meetingId);
  const copy = await savedCopy(read);
  if (copy === null) return;
  await writeCache(read.key, { meeting: { ...copy.data.meeting, tags: response.tags } }, copy.savedAt);
}
```

- **`src/api/writes.ts`:** add

```ts
// Spec §2: the body is exactly the contract's fields, parsed first, so nothing else about the phone can ride along.
export const submitTags = (request: TagSubmissionRequest) =>
  sendWrite(TagWriteResponse, "POST", "/api/v1/tags", TagSubmissionRequest.parse(request));
```

- [ ] **Step 8: The picker.** Create `src/ui/tag-panel.tsx`:

```tsx
import { ERROR_MESSAGES, MAX_TAGS_PER_SUBMISSION, TAG_CATEGORIES } from "@mymeetingapp/shared";
import { type ReactNode, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, View } from "react-native";

import { ApiError } from "@/api/client";
import { writeFailure } from "@/api/write-failure";
import { useRefreshVocabulary, useVocabularyTags } from "@/meetings/vocabulary";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { Pill } from "@/ui/pill";

const CATEGORY_LABELS: Record<(typeof TAG_CATEGORIES)[number], string> = {
  format: "Format",
  sharing: "Sharing",
  crowd: "Crowd",
  feel: "Feel",
  practical: "Practical",
};

export const OFFLINE_TAGS =
  "We couldn't reach mymeetingapp, so we can't tell whether your tags were saved. Check your connection and try again.";

interface TagPanelProps {
  initial: readonly string[];
  // Sends the chosen tags; throws when they didn't go through, and the panel says why.
  onSubmit: (tags: string[]) => Promise<void>;
  onCancel: () => void;
  // Shown under the tags (the attendance check, a suggestion).
  children?: ReactNode;
}

// Spec §8: up to 6 tags, grouped by category, from the tag list the server serves. Writes aren't optimistic: the
// choices stay until the server answers, and a refusal keeps them with the server's own words.
export function TagPanel({ initial, onSubmit, onCancel, children }: TagPanelProps) {
  const vocabulary = useVocabularyTags();
  const refreshVocabulary = useRefreshVocabulary();
  const [chosen, setChosen] = useState<string[]>([...initial]);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // A tag retired since it was chosen (the list was read again) is dropped rather than sent.
  const live = chosen.filter((slug) => vocabulary.has(slug));
  const say = (text: string) => {
    setMessage(text);
    AccessibilityInfo.announceForAccessibility(text);
  };
  const toggle = (slug: string) => {
    setMessage(null);
    if (live.includes(slug)) setChosen(live.filter((other) => other !== slug));
    else if (live.length >= MAX_TAGS_PER_SUBMISSION) say(ERROR_MESSAGES.too_many_tags);
    else setChosen([...live, slug]);
  };
  const send = () => {
    if (live.length === 0) {
      say("Choose at least one tag.");
      return;
    }
    setSending(true);
    setMessage(null);
    onSubmit(live)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code === "unknown_tag") refreshVocabulary();
        say(writeFailure(error, OFFLINE_TAGS));
      })
      .finally(() => {
        setSending(false);
      });
  };
  const tags = [...vocabulary.values()];
  return (
    <View style={{ gap: 12 }}>
      <AppText variant="heading" accessibilityRole="header">
        Tag this meeting
      </AppText>
      {tags.length === 0 ? (
        <AppText tone="muted">Tag names haven't loaded yet. They'll appear when you're back online.</AppText>
      ) : (
        <>
          <AppText tone="muted">Choose up to 6 words that describe this meeting.</AppText>
          {TAG_CATEGORIES.map((category) => {
            const inCategory = tags.filter((tag) => tag.category === category);
            if (inCategory.length === 0) return null;
            return (
              <View key={category} style={{ gap: 8 }}>
                <AppText variant="label" accessibilityRole="header">
                  {CATEGORY_LABELS[category]}
                </AppText>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {inCategory.map((tag) => (
                    <Pill
                      key={tag.slug}
                      label={tag.label}
                      selected={live.includes(tag.slug)}
                      onPress={() => {
                        toggle(tag.slug);
                      }}
                    />
                  ))}
                </View>
              </View>
            );
          })}
          <AppText>{`${String(live.length)} of ${String(MAX_TAGS_PER_SUBMISSION)} chosen`}</AppText>
          {children}
        </>
      )}
      {message !== null && <AppText accessibilityRole="alert">{message}</AppText>}
      {sending ? (
        <ActivityIndicator accessibilityLabel="Sending your tags" />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {tags.length > 0 && (
            <Button label="Send my tags" hint="Sends only these tags, for this meeting" onPress={send} />
          )}
          <Button kind="secondary" label="Cancel" onPress={onCancel} />
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 9: The meeting page's tag section.** Create `src/ui/your-tags.tsx`:

```tsx
import { ERROR_MESSAGES, type MeetingSummary, type TagWriteResponse } from "@mymeetingapp/shared";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { AccessibilityInfo, View } from "react-native";

import { submitTags } from "@/api/writes";
import { useFeatures, useUpgradeRequired } from "@/config/upgrade";
import { useVocabularyTags, type VocabularyTag } from "@/meetings/vocabulary";
import { type MyTags, myTagsOn, recordSubmission } from "@/tagging/my-tags";
import { confirmedThisWeek, taggingOpen } from "@/tagging/window";
import { civilDateOf, dateLabel } from "@/time/civil-date";
import { useNow } from "@/time/use-now";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { TagPanel } from "@/ui/tag-panel";

// "Welcoming · Coffee": a tag the phone no longer has a name for is left out rather than shown as a slug.
export function tagNames(slugs: readonly string[], labels: ReadonlyMap<string, VocabularyTag>): string {
  return slugs.flatMap((slug) => labels.get(slug)?.label ?? []).join(" · ");
}

// Why the phone offers no new submission now, or null when it does. "" means there's nothing worth saying (What
// people say already explains an opted-out group; a phone that tagged this week edits instead).
function whyNoNewTags(
  meeting: MeetingSummary,
  record: MyTags | null,
  now: Date,
  tagging: boolean,
  upgradeRequired: boolean,
): string | null {
  if (meeting.tagsDisabled) return "";
  if (!tagging) return ERROR_MESSAGES.tags_disabled;
  if (upgradeRequired) return ERROR_MESSAGES.upgrade_required;
  if (meeting.timezone === null)
    return "This meeting's listing doesn't give its time zone, so it can't be tagged.";
  if (record !== null && confirmedThisWeek(record.confirmedAt, now)) return "";
  if (!taggingOpen({ ...meeting, timezone: meeting.timezone }, now))
    return record === null ? "You can add tags from the start of this meeting until 36 hours after." : "";
  return null;
}

interface YourTagsProps {
  meeting: MeetingSummary;
  // The server's answer to a write: the page shows its counts (and, in Task 5, follows a merge).
  onAnswered: (response: TagWriteResponse) => void;
}

// Spec §8: "Tag this meeting" in the tagging window, and the phone's own record of what it tagged.
export function YourTags({ meeting, onAnswered }: YourTagsProps) {
  const now = useNow();
  const features = useFeatures();
  const upgradeRequired = useUpgradeRequired();
  const labels = useVocabularyTags();
  const [record, setRecord] = useState<MyTags | null>();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Read again on focus: "Delete all my tags" on the Me tab may have cleared it.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      myTagsOn(meeting.id).then(
        (found) => {
          if (live) setRecord(found);
        },
        () => {
          if (live) setRecord(null);
        },
      );
      return () => {
        live = false;
      };
    }, [meeting.id]),
  );
  if (record === undefined) return null;
  const tell = (text: string) => {
    setNotice(text);
    AccessibilityInfo.announceForAccessibility(text);
  };
  const submit = async (tags: string[]) => {
    const response = await submitTags({ meetingId: meeting.id, tags });
    const at = new Date();
    // The server has the tags either way; a phone that can't save its record finds out later (already_tagged).
    await recordSubmission({ id: response.meetingId, name: meeting.name }, tags, at).catch(() => undefined);
    setRecord({ meetingId: response.meetingId, name: meeting.name, tags, confirmedAt: at, updatedAt: at });
    setOpen(false);
    onAnswered(response);
    tell("Thanks. Your tags are added.");
  };
  const why = whyNoNewTags(meeting, record, now, features.tagging, upgradeRequired);
  return (
    <View style={{ gap: 8 }}>
      {record !== null && (
        <>
          <AppText variant="label">{`Your tags: ${tagNames(record.tags, labels)}`}</AppText>
          <AppText tone="muted">{`Added ${dateLabel(civilDateOf(record.confirmedAt))}`}</AppText>
        </>
      )}
      {notice !== null && <AppText accessibilityRole="alert">{notice}</AppText>}
      {open ? (
        <TagPanel
          initial={record?.tags ?? []}
          onSubmit={submit}
          onCancel={() => {
            setOpen(false);
          }}
        />
      ) : why === null ? (
        <Button
          label="Tag this meeting"
          hint="For a meeting you went to: choose words that describe it"
          onPress={() => {
            setNotice(null);
            setOpen(true);
          }}
        />
      ) : (
        why !== "" && <AppText tone="muted">{why}</AppText>
      )}
    </View>
  );
}
```

In `src/app/meeting/[id].tsx`:

- `MeetingDetail` takes `show` from `useCachedRead(detailRead(id))`.
- Add an `answered` callback:

```tsx
const answered = useCallback(
  (response: TagWriteResponse) => {
    show((data) => ({ meeting: { ...data.meeting, tags: response.tags } }));
    void saveNewCounts(response).catch(() => undefined);
  },
  [show],
);
```

- Pass it down so `MeetingInfo` renders `<YourTags meeting={meeting} onAnswered={answered} />` right after `<WhatPeopleSay meeting={meeting} />`.

- [ ] **Step 10: Run.** `pnpm --filter mobile test tag-meeting tagging-window meeting-detail`. Expected: PASS. Then run the whole mobile suite (`pnpm --filter mobile test`), since `useCachedRead` and the vocabulary provider changed. Expected: PASS.

- [ ] **Step 11: Standards and spec.** In `docs/standards.md`:
  - **"Data kept on the phone":** add "The phone's tag record goes only through `@/tagging/my-tags` (`my_tags`: what it tagged, the meeting's name and the dates), never sent."
  - **"A merged meeting id":** add "and the tag record".
  - **"Server data shown on a screen":** add "A write's answer is shown with `show(update)` from `useCachedRead` (keeping the copy's age), and its counts go into the meeting's saved copy with `saveNewCounts`, which keeps `savedAt`."
  - **New row "Tagging a meeting":** "`<YourTags meeting onAnswered>` on the meeting page, which opens `<TagPanel>` inline. What to offer comes from `taggingOpen` and `confirmedThisWeek` in `@/tagging/window`; the server's refusal is shown in its own words through `writeFailure`. Writes aren't optimistic and aren't queued offline | review, `tag-meeting.test.tsx`".

  In `SPEC.md` §8 "Tagging flow", append: "The picker opens on the meeting page itself, under the tags. The tag counts in the server's answer show at once, and nothing is sent until the person chooses 'Send my tags' (owner decisions, 2026-10-01)."

- [ ] **Step 12: Commit.** `pnpm check`, then:

```bash
git add apps/mobile docs/standards.md SPEC.md
git commit -m "feat(mobile): tag a meeting from its page, with the server's counts shown at once"
```

---

### Task 5: Edit and remove my tags, merged and removed meetings, and "Meetings I've tagged"

Spec §8: "'Edit my tags' / 'Remove my tags' whenever this device has tagged it", and a "Meetings I've tagged" list. Edits and removals work at any time. This task also handles the cases where the record and the server disagree (Review Focus 2) and where a meeting moved or went (Review Focus 3).

**Files:**

- Create: `apps/mobile/src/ui/my-tagged-meetings.tsx`, `apps/mobile/test/edit-tags.test.tsx`, `apps/mobile/test/my-tags.test.tsx`
- Modify: `apps/mobile/src/api/writes.ts`, `apps/mobile/src/tagging/my-tags.ts`, `apps/mobile/src/ui/your-tags.tsx`, `apps/mobile/src/ui/tag-panel.tsx`, `apps/mobile/src/ui/delete-all-my-tags.tsx`, `apps/mobile/src/app/meeting/[id].tsx`, `apps/mobile/src/app/(tabs)/me.tsx`, `docs/standards.md`

**Interfaces:**

- Consumes: Task 4's record, panel and `YourTags`; `meetingMoved`; `ConfirmButton`; `TagEditRequest` from shared.
- Produces:
  - from `@/api/writes`:
    - `editTags(meetingId: string, tags: string[]): Promise<TagWriteResponse>` (PUT);
    - `removeTags(meetingId: string): Promise<TagWriteResponse>` (DELETE).
  - from `@/tagging/my-tags`:
    - `recordEdit(meeting: { id: string; name: string }, tags: string[], at: Date): Promise<void>`, which keeps `confirmed_at` and sets it to `at` only for a new row;
    - `forgetMyTags(meetingId: string): Promise<void>`;
    - `allMyTags(): Promise<MyTags[]>`, newest change first;
    - `forgetAllMyTags(): Promise<void>`.
  - `TagPanel` gains `mode: "new" | "edit"` and `onEdit: (tags: string[]) => Promise<void>`. In "new" mode an `already_tagged` refusal switches it to "edit" with the same choices.
  - `<DeleteAllMyTags onDeleted />` and `<MyTaggedMeetings version />`.

- [ ] **Step 1: Failing tests.** Create `apps/mobile/test/edit-tags.test.tsx`. Its setup is `tag-meeting.test.tsx`'s (copy the imports, `beforeEach`, `openMeeting` and `choose`), plus `recordSubmission`, `myTagsOn` and a `remove()` helper that presses "Remove my tags", sees the question and presses "Remove my tags" again:

```tsx
const LATER = "2026-10-22T17:00:00Z"; // a Thursday: no Nooners window is open
const RECORDED = new Date("2026-10-05T17:00:00Z");
const COUNTS = [
  { slug: "welcoming", count: 14 },
  { slug: "quiet", count: 2 },
];
const SURVIVOR = "9b2e4c1a-5d6f-4a7b-8c9d-0e1f2a3b4c5d";
const TAG_PATH = `/api/v1/tags/${ID}`;
const writes = () => api.requests.filter((r) => r.path.startsWith("/api/v1/tags"));

async function remove() {
  await fireEvent.press(screen.getByRole("button", { name: "Remove my tags" }));
  expect(screen.getByText("Remove your tags from this meeting? Other people's tags stay.")).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Remove my tags" }));
}

describe("a meeting this phone tagged", () => {
  beforeEach(async () => {
    await recordSubmission({ id: ID, name: "Nooners" }, ["welcoming"], RECORDED);
  });

  it("offers Edit and Remove at any time, and no new tagging outside the window", async () => {
    await openMeeting(LATER);
    expect(screen.getByText("Your tags: Welcoming")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Edit my tags" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Remove my tags" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Tag this meeting" })).toBeNull();
  });

  it("edits starting from its tags, keeps the first date, and shows the new counts", async () => {
    api.reply(TAG_PATH, { meetingId: ID, tags: COUNTS }, 200, "PUT");
    await openMeeting(LATER);
    await fireEvent.press(screen.getByRole("button", { name: "Edit my tags" }));
    expect(screen.getByRole("header", { name: "Edit my tags" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Welcoming" })).toHaveAccessibilityState({ checked: true });
    await choose("Quiet");
    await fireEvent.press(screen.getByRole("button", { name: "Save my tags" }));
    expect(await screen.findByText("Your tags are saved.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Quiet 2 people")).toBeOnTheScreen();
    const [write] = writes();
    expect(write?.method).toBe("PUT");
    expect(write?.body).toBe('{"tags":["welcoming","quiet"]}');
    expect(await myTagsOn(ID)).toEqual({
      meetingId: ID,
      name: "Nooners",
      tags: ["welcoming", "quiet"],
      confirmedAt: RECORDED,
      updatedAt: new Date(LATER),
    });
  });

  it("removes after asking, sending no body, and forgets the record", async () => {
    api.reply(TAG_PATH, { meetingId: ID, tags: [{ slug: "welcoming", count: 13 }] }, 200, "DELETE");
    await openMeeting(LATER);
    await remove();
    expect(await screen.findByText("Your tags are removed.")).toBeOnTheScreen();
    expect(screen.getByLabelText("Welcoming 13 people")).toBeOnTheScreen();
    expect(writes()[0]).toMatchObject({ method: "DELETE", body: "" });
    expect(await myTagsOn(ID)).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove my tags" })).toBeNull();
  });

  it("keeps Remove when tagging is switched off or the app is too old, and hides Edit", async () => {
    api.reply("/api/v1/config", {
      ...CONFIG,
      minSupportedVersion: { ios: "9.0.0", android: "9.0.0" },
      features: { tagging: false, suggestions: false },
    });
    await openMeeting(LATER);
    expect(screen.getByRole("button", { name: "Remove my tags" })).toBeOnTheScreen();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Edit my tags" })).toBeNull();
    });
  });

  it("offers Tag this meeting again a week after the last time, starting from the same tags", async () => {
    await openMeeting("2026-10-12T17:00:00Z");
    await fireEvent.press(screen.getByRole("button", { name: "Tag this meeting" }));
    expect(screen.getByRole("checkbox", { name: "Welcoming" })).toHaveAccessibilityState({ checked: true });
  });

  it.each([
    ["PUT", "Edit"],
    ["DELETE", "Remove"],
  ])("forgets its record when the server holds no tags from this phone (%s)", async (method, action) => {
    api.reply(
      TAG_PATH,
      { error: { code: "not_tagged", message: "You haven't tagged this meeting." } },
      404,
      method,
    );
    await openMeeting(LATER);
    if (action === "Edit") {
      await fireEvent.press(screen.getByRole("button", { name: "Edit my tags" }));
      await fireEvent.press(screen.getByRole("button", { name: "Save my tags" }));
    } else {
      await remove();
    }
    expect(await screen.findByText("You haven't tagged this meeting.")).toBeOnTheScreen();
    expect(await myTagsOn(ID)).toBeNull();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Remove my tags" })).toBeNull();
    });
  });

  it("can remove its tags from a meeting that's no longer listed", async () => {
    api.reply(
      PATH,
      {
        error: {
          code: "meeting_not_found",
          message: "We couldn't find that meeting. It may have been removed from the meeting list.",
        },
      },
      404,
    );
    api.reply(TAG_PATH, { meetingId: ID, tags: [] }, 200, "DELETE");
    setNow(LATER);
    await renderApp(`/meeting/${ID}`);
    expect(
      await screen.findByText(
        "We couldn't find that meeting. It may have been removed from the meeting list.",
      ),
    ).toBeOnTheScreen();
    await remove();
    expect(await screen.findByText("Your tags are removed.")).toBeOnTheScreen();
    expect(await myTagsOn(ID)).toBeNull();
  });
});

describe("a phone whose record is missing or moved", () => {
  it("offers to save the choices as an edit when the server says this phone already tagged it", async () => {
    api.reply(
      "/api/v1/tags",
      {
        error: {
          code: "already_tagged",
          message: "You've already tagged this meeting in the last 7 days. You can edit your tags instead.",
        },
      },
      409,
      "POST",
    );
    api.reply(TAG_PATH, { meetingId: ID, tags: COUNTS }, 200, "PUT");
    await openMeeting(STARTED);
    await fireEvent.press(screen.getByRole("button", { name: "Tag this meeting" }));
    await choose("Quiet");
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    expect(await screen.findByText(/You can edit your tags instead\./)).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Edit my tags" })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Save my tags" }));
    expect(await screen.findByText("Your tags are saved.")).toBeOnTheScreen();
    expect(writes().map((w) => [w.method, w.body])).toEqual([
      ["POST", `{"meetingId":"${ID}","tags":["quiet"]}`],
      ["PUT", '{"tags":["quiet"]}'],
    ]);
    expect(await myTagsOn(ID)).toMatchObject({ tags: ["quiet"], confirmedAt: new Date(STARTED) });
  });

  it("follows a meeting that merged before the write landed", async () => {
    api.reply("/api/v1/tags", { meetingId: SURVIVOR, tags: COUNTS }, 201, "POST");
    api.reply(`/api/v1/meetings/${SURVIVOR}`, { meeting: meeting({ id: SURVIVOR, tags: COUNTS }) });
    setNow(STARTED);
    const app = await renderApp(`/meeting/${ID}`);
    await screen.findByLabelText("Welcoming 14 people");
    await fireEvent.press(screen.getByRole("button", { name: "Tag this meeting" }));
    await choose("Quiet");
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    await waitFor(() => {
      expect(app.getPathname()).toBe(`/meeting/${SURVIVOR}`);
    });
    expect(await myTagsOn(SURVIVOR)).toMatchObject({ tags: ["quiet"] });
    expect(await myTagsOn(ID)).toBeNull();
    expect(await screen.findByText("Your tags: Quiet")).toBeOnTheScreen();
  });
});
```

Create `apps/mobile/test/my-tags.test.tsx` for the Me tab:

```tsx
// Setup as delete-all.test.tsx (imports, beforeEach, deleteAll()), plus recordSubmission and failStatements.
describe("Meetings I've tagged", () => {
  it("lists what this phone tagged, newest first, and opens a meeting", async () => {
    await recordSubmission(
      { id: ID, name: "Nooners" },
      ["welcoming", "coffee"],
      new Date("2026-10-05T17:00:00Z"),
    );
    await recordSubmission({ id: OTHER, name: "Early Birds" }, ["quiet"], new Date("2026-10-06T12:00:00Z"));
    api.reply(`/api/v1/meetings/${ID}`, { meeting: meeting() });
    const app = await renderApp("/me");
    await launchReadsLanded();
    expect(screen.getByRole("header", { name: "Meetings I've tagged" })).toBeOnTheScreen();
    const names = screen
      .getAllByRole("button", { name: /^(Nooners|Early Birds)$/ })
      .map((b) => b.props.accessibilityLabel);
    expect(names).toEqual(["Early Birds", "Nooners"]);
    expect(screen.getByText("Welcoming · Coffee · Oct 5, 2026")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Nooners" }));
    await waitFor(() => {
      expect(app.getPathname()).toBe(`/meeting/${ID}`);
    });
  });

  it("says when this phone hasn't tagged anything", async () => {
    await renderApp("/me");
    await launchReadsLanded();
    expect(screen.getByText("You haven't tagged any meetings on this phone.")).toBeOnTheScreen();
  });

  it("is cleared by Delete all my tags once the server confirms, and kept when it can't be reached", async () => {
    await recordSubmission({ id: ID, name: "Nooners" }, ["quiet"], new Date("2026-10-05T17:00:00Z"));
    await deleteAll(); // no reply: unreachable
    await screen.findByText(/to finish deleting/);
    expect(screen.getByRole("button", { name: "Nooners" })).toBeOnTheScreen();
    api.reply(DELETE_MINE, { deletedTags: 1 }, 200, "POST");
    await fireEvent.press(screen.getByRole("button", { name: "Delete all my tags" }));
    await fireEvent.press(screen.getByRole("button", { name: "Delete all my tags" }));
    expect(await screen.findByText("You haven't tagged any meetings on this phone.")).toBeOnTheScreen();
  });

  it("says so when the phone can't clear its own list after the server deleted", async () => {
    await recordSubmission({ id: ID, name: "Nooners" }, ["quiet"], new Date("2026-10-05T17:00:00Z"));
    api.reply(DELETE_MINE, { deletedTags: 1 }, 200, "POST");
    await failStatements("runAsync", "delete from my_tags");
    await deleteAll();
    expect(
      await screen.findByText(/This phone couldn't clear its own list of tagged meetings\. Try again\.$/),
    ).toBeOnTheScreen();
  });
});
```

(`OTHER` is a second UUID constant; `meeting`, `waitFor` and `failStatements` are imported as in the files they come from.)

- [ ] **Step 2: Watch them fail.** `pnpm --filter mobile test edit-tags my-tags`. Expected: FAIL, no "Edit my tags" button and no list.

- [ ] **Step 3: The writes and the record.** Add to `src/api/writes.ts`:

```ts
// Spec §5: edits keep the original confirmation; deletes have no body, and both work at any time.
export const editTags = (meetingId: string, tags: string[]) =>
  sendWrite(
    TagWriteResponse,
    "PUT",
    `/api/v1/tags/${encodeURIComponent(meetingId)}`,
    TagEditRequest.parse({ tags }),
  );

export const removeTags = (meetingId: string) =>
  sendWrite(TagWriteResponse, "DELETE", `/api/v1/tags/${encodeURIComponent(meetingId)}`);
```

Add to `src/tagging/my-tags.ts`:

```ts
// An edit the server accepted. It keeps the first confirmation; a phone that had no record (the server said it
// already tagged) starts one dated now.
export function recordEdit(meeting: { id: string; name: string }, tags: string[], at: Date): Promise<void> {
  return inTransaction(async (db) => {
    await db.runAsync(
      `insert into my_tags (meeting_id, name, tags, confirmed_at, updated_at) values (?, ?, ?, ?, ?)
       on conflict (meeting_id) do update set name = excluded.name, tags = excluded.tags, updated_at = excluded.updated_at`,
      [meeting.id, meeting.name, JSON.stringify(tags), at.getTime(), at.getTime()],
    );
  });
}

export function forgetMyTags(meetingId: string): Promise<void> {
  return inTransaction(async (db) => {
    await db.runAsync("delete from my_tags where meeting_id = ?", [meetingId]);
  });
}

// "Meetings I've tagged", the latest change first.
export async function allMyTags(): Promise<MyTags[]> {
  const db = await appDatabase();
  const rows = await db.getAllAsync(
    "select meeting_id, name, tags, confirmed_at, updated_at from my_tags order by updated_at desc, rowid desc",
    [],
  );
  return rows.map(parse);
}

// After "Delete all my tags" succeeded on the server (owner decision 6).
export function forgetAllMyTags(): Promise<void> {
  return inTransaction(async (db) => {
    await db.runAsync("delete from my_tags", []);
  });
}
```

- [ ] **Step 4: Edit mode in the panel.** In `src/ui/tag-panel.tsx`:
  - Add the props `mode: "new" | "edit"` and `onEdit: (tags: string[]) => Promise<void>`, and hold `const [current, setCurrent] = useState(mode)`.
  - The title is "Tag this meeting" or "Edit my tags". The send button is "Send my tags" or "Save my tags", with the hint "Replaces this phone's tags on this meeting" when editing.
  - `send` calls `current === "new" ? onSubmit(live) : onEdit(live)`.
  - In its `catch`, before saying the failure:

```ts
// Spec §5: "the app should offer to edit instead". The same choices, saved as this phone's tags.
if (error instanceof ApiError && error.code === "already_tagged") setCurrent("edit");
```

- [ ] **Step 5: Edit, remove and merges in `YourTags`.**
  - **The answer callback:** `onAnswered(response)` is unchanged; the page decides what a merged answer means (Step 6).
  - **`edit(tags)`:** `editTags(meeting.id, tags)`, then `recordEdit({ id: response.meetingId, name: meeting.name }, tags, new Date())` (best effort). Then set the record, close the panel, `onAnswered(response)`, and say "Your tags are saved.".
  - **`not_tagged`:** wrap both writes so that, on `ApiError` `not_tagged`, `await forgetMyTags(meeting.id).catch(() => undefined)` runs and the record becomes `null` before rethrowing; the panel then shows the server's words.
  - **Remove:** `<ConfirmButton label="Remove my tags" hint="Asks before removing this phone's tags from this meeting" question="Remove your tags from this meeting? Other people's tags stay." confirmLabel="Remove my tags" confirmHint="Removes them from our server now" cancelLabel="Keep them" onConfirm={remove} />`, shown whenever `record !== null` and the panel is closed, whatever the switches.
    - `remove` calls `removeTags(meeting.id)`, then `forgetMyTags`, then `onAnswered(response)`, and says "Your tags are removed.".
    - On `not_tagged` or `meeting_not_found`, it forgets the record and says the server's words. Any other failure says `writeFailure(error, OFFLINE_TAGS)`.
  - **Edit button:** `<Button kind="secondary" label="Edit my tags" hint="Change the tags this phone added" />`, shown when `record !== null`, `!meeting.tagsDisabled`, `features.tagging` and `!upgradeRequired`. It opens the panel with `mode="edit"`.
  - **Reopening for new tags:** when `why === null` and a record exists (a week later), "Tag this meeting" opens with `mode="new"` and `initial={record.tags}`.
  - **The merged-or-removed page:** export a small `RemoveMyTags({ meetingId })` from the same file, holding just the record lookup and the remove button, so the page that says a meeting is gone can offer it.

- [ ] **Step 6: The page follows a merge.** In `[id].tsx`, `answered` becomes:

```tsx
const answered = useCallback(
  (response: TagWriteResponse) => {
    if (response.meetingId === id) {
      show((data) => ({ meeting: { ...data.meeting, tags: response.tags } }));
      void saveNewCounts(response).catch(() => undefined);
      return;
    }
    // The meeting merged after the page read it: what the phone keeps follows first (meetingMoved would otherwise
    // copy the old saved copy over the new counts), then the page follows the survivor, as a read would.
    void meetingMoved(id, response.meetingId)
      .then(() => saveNewCounts(response))
      .catch(() => undefined)
      .then(() => {
        router.setParams({ id: response.meetingId });
      });
  },
  [id, show],
);
```

In `MeetingDetail`, a failed read that is `gone` renders the message, then `<RemoveMyTags meetingId={id} />`.

- [ ] **Step 7: The Me tab list.** Create `src/ui/my-tagged-meetings.tsx`:

```tsx
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { useVocabularyTags } from "@/meetings/vocabulary";
import { allMyTags, type MyTags } from "@/tagging/my-tags";
import { civilDateOf, dateLabel } from "@/time/civil-date";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { tagNames } from "@/ui/your-tags";

// Spec §8's "Meetings I've tagged", from the phone's own record. `version` changes when the record was cleared.
export function MyTaggedMeetings({ version }: { version: number }) {
  const labels = useVocabularyTags();
  const [rows, setRows] = useState<MyTags[] | null>(null);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      allMyTags().then(
        (found) => {
          if (live) setRows(found);
        },
        () => {
          if (live) setRows([]);
        },
      );
      return () => {
        live = false;
      };
    }, [version]),
  );
  if (rows === null) return null;
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="label" accessibilityRole="header">
        Meetings I've tagged
      </AppText>
      {rows.length === 0 ? (
        <AppText tone="muted">You haven't tagged any meetings on this phone.</AppText>
      ) : (
        rows.map((row) => (
          <View key={row.meetingId} style={{ alignItems: "flex-start" }}>
            <Button
              kind="text"
              label={row.name}
              hint="Opens the meeting"
              onPress={() => {
                router.push(`/meeting/${row.meetingId}`);
              }}
            />
            <AppText tone="muted">{`${tagNames(row.tags, labels)} · ${dateLabel(civilDateOf(row.updatedAt))}`}</AppText>
          </View>
        ))
      )}
    </View>
  );
}
```

- **`DeleteAllMyTags`:** add an `onDeleted: () => void` prop. On success it runs `forgetAllMyTags()`. If that rejects, the message gains " This phone couldn't clear its own list of tagged meetings. Try again." Then it calls `onDeleted()`.
- **`me.tsx`:** holds `const [version, setVersion] = useState(0)` and renders, under "Your tags", `<MyTaggedMeetings version={version} />`, then `<DeleteAllMyTags onDeleted={() => { setVersion((v) => v + 1); }} />`.

- [ ] **Step 8: Run.** `pnpm --filter mobile test edit-tags my-tags tag-meeting delete-all meeting-detail`. Expected: PASS.

- [ ] **Step 9: Standards.**
  - **"Destructive actions in the app":** add "Remove my tags" and "Delete all my tags" as uses.
  - **"Tagging a meeting":** add "Edit and remove work at any time. `already_tagged` turns the picker into an edit with the same choices. `not_tagged` forgets the phone's record. A write answered for another meeting id follows it as a merge."
- [ ] **Step 10: Commit.** `pnpm check`, then:

```bash
git add apps/mobile docs/standards.md
git commit -m "feat(mobile): edit and remove my tags, follow merges, and list the meetings I've tagged"
```

---

### Task 6: The attendance check

Spec §8: during a meeting's time, a meeting page checks on the phone whether the person is near it. It does this silently, only when location is already allowed. The tag panel offers the same check, with the spec's explanation. Only "near" is kept, per occurrence, and a new submission sends it as `nearMeeting`. The exact position never leaves `src/location`.

**Files:**

- Create:
  - `apps/mobile/src/location/attendance.ts`, `apps/mobile/src/tagging/attendance-record.ts`, `apps/mobile/src/tagging/use-attendance-check.ts`, `apps/mobile/src/ui/attendance-offer.tsx`
  - `apps/mobile/test/attendance.test.ts`, `apps/mobile/test/attendance-check.test.tsx`
- Modify:
  - `apps/mobile/modules/native-location/ios/NativeLocationModule.swift`, `apps/mobile/modules/native-location/index.ts`
  - `apps/mobile/test/native/native-location.ts`, `apps/mobile/test/native/expo-location.ts`
  - `apps/mobile/app.config.ts`, `apps/mobile/test/app-shell.test.tsx`
  - `apps/mobile/src/tagging/window.ts`, `apps/mobile/src/tagging/my-tags.ts` (`forgetAllMyTags`), `apps/mobile/src/meetings/merged.ts`, `apps/mobile/src/cache/prune.ts`, `apps/mobile/src/db/migrations.ts`
  - `apps/mobile/src/ui/your-tags.tsx`, `apps/mobile/src/app/meeting/[id].tsx`
  - `apps/mobile/test/app-data.ts`, `apps/mobile/test/tag-meeting.test.tsx` (bodies gain `nearMeeting`)
  - `docs/standards.md`, `apps/web/src/content/privacy-inventory.ts` (nothing new to store server-side; check only)

**Interfaces:**

- Consumes: `distanceKm`, `type LatLng` from `@/location/geo`; `withinTimeLimit`; `lastOccurrence`, `occurrenceEnd`, `type Occurrence` from `@/meetings/schedule`; `TAGGING_WINDOW_MS`.
- Produces:
  - `type AttendanceAnswer = "near" | "notNear" | "denied" | "approximate" | "unavailable"` and `checkAttendance(place: LatLng, when: "tap" | "open"): Promise<AttendanceAnswer>` from `@/location/attendance`;
  - from `@/tagging/window`:
    - `attendanceOccurrence(meeting: Scheduled, now: Date): Occurrence | null`;
    - `checkablePlace(meeting: MeetingSummary): LatLng | null`;
  - `recordNear(meetingId: string, occurrenceStart: Date): Promise<void>` and `wasNear(meetingId: string, occurrenceStart: Date): Promise<boolean>` from `@/tagging/attendance-record`;
  - `useAttendanceCheck(meeting: MeetingSummary): void` from `@/tagging/use-attendance-check`;
  - `<AttendanceOffer meetingId place occurrenceStart />` from `@/ui/attendance-offer`;
  - native `requestTemporaryFullAccuracy(purposeKey: string): Promise<boolean>`, iOS only;
  - test helpers:
    - `setDevicePosition({ latitude, longitude, accuracy? })`;
    - `setPrecise(boolean)` (the permission's `ios.accuracy` / `android.accuracy`);
    - `setPreciseAnswer(boolean)` (what the person picks when asked again on Android);
    - `setTemporaryAccuracyAnswer(boolean)` and `temporaryAccuracyRequests()` (iOS).

- [ ] **Step 1: Fakes.**
  - **`test/native/expo-location.ts`:**
    - add `Accuracy.High = 4`;
    - let a position carry `accuracy` (default 20);
    - add `precise` (default `true`), with `setPrecise`;
    - add `preciseAnswer` (default `true`), with `setPreciseAnswer`;
    - `response()` gains `ios: { scope: "whenInUse", accuracy: precise ? "full" : "reduced" }` and `android: { accuracy: precise ? "fine" : "coarse" }`;
    - `requestForegroundPermissionsAsync` on an already-granted, imprecise permission sets `precise = preciseAnswer`, as Android's upgrade dialog does;
    - reset all of these in `resetLocation`.
  - **`test/native/native-location.ts`:** add `requestTemporaryFullAccuracy(purposeKey)`. It pushes `purposeKey` onto `temporaryAccuracyRequests`, answers `temporaryAnswer` (default `true`), and when `true` calls `setPrecise(true)` from `./expo-location`, so the permission now reads full. Reset both in `resetPlaces`.

- [ ] **Step 2: Failing unit tests.** Create `apps/mobile/test/attendance.test.ts`:

```ts
import { Platform } from "react-native";

import { checkAttendance } from "@/location/attendance";
import { attendanceOccurrence } from "@/tagging/window";

import {
  permissionRequests,
  setDevicePosition,
  setLocationPermission,
  setPermissionAnswer,
  setPrecise,
  setPreciseAnswer,
} from "./native/expo-location";
import { setTemporaryAccuracyAnswer, temporaryAccuracyRequests } from "./native/native-location";

const ST_LUKES = { latitude: 36.1627, longitude: -86.7816 };
// 0.0013° of latitude is about 145 m; 0.0023° about 256 m; 0.004° about 445 m; 0.0053° about 589 m.
const at = (dLat: number, accuracy = 20) => ({ latitude: 36.1627 + dLat, longitude: -86.7816, accuracy });

describe("checkAttendance (spec §8: 200 m plus the fix's accuracy, at most 500 m)", () => {
  beforeEach(() => {
    setLocationPermission("granted");
  });

  it.each([
    ["145 m away, 20 m accuracy", at(0.0013), "near"],
    ["256 m away, 20 m accuracy", at(0.0023), "notNear"],
    ["256 m away, 100 m accuracy", at(0.0023, 100), "near"],
    ["445 m away, 400 m accuracy (capped at 500)", at(0.004, 400), "near"],
    ["589 m away, 400 m accuracy (capped at 500)", at(0.0053, 400), "notNear"],
  ])("%s", async (_where, position, answer) => {
    setDevicePosition(position);
    expect(await checkAttendance(ST_LUKES, "open")).toBe(answer);
  });

  it("never shows a dialog when a page opens: no permission is 'denied', approximate is 'approximate'", async () => {
    setLocationPermission("undetermined");
    expect(await checkAttendance(ST_LUKES, "open")).toBe("denied");
    setLocationPermission("granted");
    setPrecise(false);
    expect(await checkAttendance(ST_LUKES, "open")).toBe("approximate");
    expect(permissionRequests()).toBe(0);
    expect(temporaryAccuracyRequests).toEqual([]);
  });

  it("asks for temporary full accuracy on an iPhone sharing only approximate location, when the person taps", async () => {
    setPrecise(false);
    setDevicePosition(at(0.0013));
    expect(await checkAttendance(ST_LUKES, "tap")).toBe("near");
    expect(temporaryAccuracyRequests).toEqual(["AttendanceCheck"]);
  });

  it("stays approximate when the person keeps approximate location", async () => {
    setPrecise(false);
    setTemporaryAccuracyAnswer(false);
    expect(await checkAttendance(ST_LUKES, "tap")).toBe("approximate");
  });

  it("asks Android for precise location when the person taps", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    setPrecise(false);
    setPreciseAnswer(true);
    setDevicePosition(at(0.0013));
    expect(await checkAttendance(ST_LUKES, "tap")).toBe("near");
    expect(permissionRequests()).toBe(1);
  });

  it("asks for permission on a tap when none was given, and respects a no", async () => {
    setLocationPermission("undetermined");
    // The fake's person answers "granted" unless told otherwise; this one says no.
    setPermissionAnswer("denied");
    expect(await checkAttendance(ST_LUKES, "tap")).toBe("denied");
  });

  it("is 'unavailable' when the phone can't find itself", async () => {
    setDevicePosition("fails");
    expect(await checkAttendance(ST_LUKES, "open")).toBe("unavailable");
  });
});

describe("attendanceOccurrence (15 min before the start to 30 min after the end, or 90 min after a start with no end)", () => {
  const NOONERS = { day: 1, time: "12:00", endTime: "13:00", timezone: "America/Chicago" };
  it.each([
    ["16 minutes before", "2026-10-05T16:44:00Z", null],
    ["15 minutes before", "2026-10-05T16:45:00Z", "2026-10-05T17:00:00Z"],
    ["29 minutes after the end", "2026-10-05T18:29:00Z", "2026-10-05T17:00:00Z"],
    ["30 minutes after the end", "2026-10-05T18:30:00Z", null],
  ])("%s", (_when, now, start) => {
    expect(attendanceOccurrence(NOONERS, new Date(now))?.start ?? null).toEqual(
      start === null ? null : new Date(start),
    );
  });

  it("allows 90 minutes after the start when there's no end time", () => {
    const noEnd = { ...NOONERS, endTime: null };
    expect(attendanceOccurrence(noEnd, new Date("2026-10-05T18:29:00Z"))?.start).toEqual(
      new Date("2026-10-05T17:00:00Z"),
    );
    expect(attendanceOccurrence(noEnd, new Date("2026-10-05T18:30:00Z"))).toBeNull();
  });
});
```

- [ ] **Step 3: Watch them fail.** `pnpm --filter mobile test attendance.test`. Expected: FAIL, modules missing.

- [ ] **Step 4: Native temporary accuracy.**
  - **`modules/native-location/ios/NativeLocationModule.swift`:** add inside `definition()`:

```swift
    // Spec §8: an iPhone sharing only approximate location asks, for the attendance check alone, for full accuracy
    // until the app leaves the foreground. The purpose key names the string in app.config.ts's
    // NSLocationTemporaryUsageDescriptionDictionary. Answers whether full accuracy is on afterwards.
    AsyncFunction("requestTemporaryFullAccuracy") { (purposeKey: String, promise: Promise) in
      let manager = CLLocationManager()
      if manager.accuracyAuthorization == .fullAccuracy {
        promise.resolve(true)
        return
      }
      manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: purposeKey) { _ in
        promise.resolve(manager.accuracyAuthorization == .fullAccuracy)
      }
    }.runOnQueue(.main)
```

- **`modules/native-location/index.ts`:** add `requestTemporaryFullAccuracy(purposeKey: string): Promise<unknown>;` with the comment "iOS only; Android asks again through expo-location instead."
- **`app.config.ts`:** add

```ts
    infoPlist: {
      // Spec §8, §11: the attendance check's one-time request for full accuracy. Its key is ATTENDANCE_PURPOSE_KEY in
      // src/location/attendance.ts.
      NSLocationTemporaryUsageDescriptionDictionary: {
        AttendanceCheck: `${APP_NAME} checks once that you're near the meeting, to stop spam. Your location never leaves your phone.`,
      },
    },
```

under `ios`. Add to `app-shell.test.tsx`: "explains the attendance check's one-time request for full accuracy", asserting `config.ios.infoPlist.NSLocationTemporaryUsageDescriptionDictionary.AttendanceCheck` equals that literal string.

- [ ] **Step 5: The check.** Create `src/location/attendance.ts`:

```ts
import NativeLocation from "@modules/native-location";
import * as Location from "expo-location";
import { Platform } from "react-native";
import { z } from "zod";

import { distanceKm, type LatLng } from "@/location/geo";
import { withinTimeLimit } from "@/location/time-limit";

export type AttendanceAnswer = "near" | "notNear" | "denied" | "approximate" | "unavailable";

// Spec §8: within 200 m, plus the fix's own accuracy, but never more than 500 m.
const NEAR_METERS = 200;
const MOST_METERS = 500;
// app.config.ts: ios.infoPlist.NSLocationTemporaryUsageDescriptionDictionary.
const ATTENDANCE_PURPOSE_KEY = "AttendanceCheck";

const precise = (permission: Location.LocationPermissionResponse) =>
  Platform.OS === "android"
    ? permission.android?.accuracy === "fine"
    : permission.ios?.accuracy !== "reduced";

// "open": a meeting page opening by itself, with no dialog of any kind (spec §2). "tap": the person asked for the
// check, so permission, and then precise location (Android) or temporary full accuracy (iOS), may be asked for.
async function preciseAccess(when: "tap" | "open"): Promise<"precise" | "approximate" | "denied"> {
  let permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) {
    if (when === "open") return "denied";
    permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return "denied";
  }
  if (precise(permission)) return "precise";
  if (when === "open") return "approximate";
  if (Platform.OS === "android")
    return precise(await Location.requestForegroundPermissionsAsync()) ? "precise" : "approximate";
  const full = z.boolean().parse(await NativeLocation.requestTemporaryFullAccuracy(ATTENDANCE_PURPOSE_KEY));
  return full ? "precise" : "approximate";
}

// Spec §2: the proximity check runs on the phone. The position is used here and dropped; only the answer leaves.
export async function checkAttendance(place: LatLng, when: "tap" | "open"): Promise<AttendanceAnswer> {
  const access = await preciseAccess(when);
  if (access !== "precise") return access;
  try {
    const { coords } = await withinTimeLimit(
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: when === "tap",
      }),
    );
    const meters = distanceKm(place, coords) * 1000;
    return meters <= Math.min(NEAR_METERS + (coords.accuracy ?? 0), MOST_METERS) ? "near" : "notNear";
  } catch {
    return "unavailable";
  }
}
```

Add to `src/tagging/window.ts`:

```ts
const CHECK_EARLY_MS = 15 * MINUTE_MS;
const CHECK_LATE_MS = 30 * MINUTE_MS;
const CHECK_NO_END_MS = 90 * MINUTE_MS;

// Spec §8: a meeting's time for the attendance check is 15 minutes before its start to 30 minutes after its end, or
// 90 minutes after the start when it has no end time. The occurrence whose time contains `now`, or null.
export function attendanceOccurrence(meeting: Scheduled, now: Date): Occurrence | null {
  const occurrence = lastOccurrence(meeting, new Date(now.getTime() + CHECK_EARLY_MS));
  const hasEnd = meeting.endTime !== null && meeting.endTime !== meeting.time;
  const until = hasEnd
    ? occurrenceEnd(meeting, occurrence).getTime() + CHECK_LATE_MS
    : occurrence.start.getTime() + CHECK_NO_END_MS;
  return now.getTime() < until ? occurrence : null;
}

// Where an attendance check can look: an in-person or hybrid meeting with a map point and a zone.
export function checkablePlace(meeting: MeetingSummary): LatLng | null {
  if (meeting.attendance === "online" || meeting.latitude === null || meeting.longitude === null) return null;
  return { latitude: meeting.latitude, longitude: meeting.longitude };
}
```

Add `"attendance_checks"` to `TABLES`, and append to `MIGRATIONS`:

```ts
  // Spec §8, §13: attendance-check results stay on the phone. Only "near" is kept, per occurrence, never a position.
  `create table attendance_checks (meeting_id text not null, occurrence_start integer not null, primary key (meeting_id, occurrence_start)) strict;`,
```

Create `src/tagging/attendance-record.ts`:

```ts
import { appDatabase, inTransaction } from "@/db/database";

export function recordNear(meetingId: string, occurrenceStart: Date): Promise<void> {
  return inTransaction(async (db) => {
    await db.runAsync(
      "insert or ignore into attendance_checks (meeting_id, occurrence_start) values (?, ?)",
      [meetingId, occurrenceStart.getTime()],
    );
  });
}

export async function wasNear(meetingId: string, occurrenceStart: Date): Promise<boolean> {
  const db = await appDatabase();
  const row = await db.getFirstAsync(
    "select 1 from attendance_checks where meeting_id = ? and occurrence_start = ?",
    [meetingId, occurrenceStart.getTime()],
  );
  return row !== null;
}
```

Then wire the result into the rest of the app:

- **`meetingMoved`:** moves `attendance_checks` rows with `insert or ignore … select ?, occurrence_start …` plus a delete, in its transaction.
- **`forgetAllMyTags`:** also runs `delete from attendance_checks`. Its comment names both.
- **`pruneCache`:** adds `delete from attendance_checks where occurrence_start < ?` with `[now - TAGGING_WINDOW_MS]`. Its comment says that a result is useless once its occurrence's tagging window has closed.
- **The standards row "Data kept on the phone":** gains "and attendance results, which pruneCache drops once their tagging window has closed".

- [ ] **Step 6: Failing screen tests.** Create `apps/mobile/test/attendance-check.test.tsx`. Its setup is `tag-meeting.test.tsx`'s, with `setLocationPermission`, `setDevicePosition`, `permissionRequests` and `permissionChecks` from the location fake.

```tsx
const NEAR = { latitude: 36.164, longitude: -86.7816 }; // about 145 m from St. Luke's
const FAR = { latitude: 36.2, longitude: -86.7816 };
const EXPLANATION = "We check you're near the meeting to stop spam. Your location never leaves your phone.";

describe("the attendance check", () => {
  it("checks silently when a meeting page opens during the meeting, with location already allowed, and sends nearMeeting", async () => {
    setLocationPermission("granted");
    setDevicePosition(NEAR);
    api.reply("/api/v1/tags", { meetingId: ID, tags: COUNTS }, 201, "POST");
    await openMeeting("2026-10-05T17:10:00Z");
    await waitFor(async () => {
      expect(await wasNear(ID, new Date(STARTED))).toBe(true);
    });
    expect(permissionRequests()).toBe(0);
    await tag("Quiet");
    await screen.findByText("Thanks. Your tags are added.");
    expect(tagWrites()[0]?.body).toBe(`{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":true}`);
  });

  it.each([
    ["outside the meeting's time (2 PM, past 1:30 PM)", "granted", "2026-10-05T19:00:00Z"],
    ["without permission", "undetermined", "2026-10-05T17:10:00Z"],
  ] as const)("does nothing %s, and never asks", async (_when, permission, at) => {
    setLocationPermission(permission);
    await openMeeting(at);
    await fireEvent.press(screen.getByRole("button", { name: "Tag this meeting" }));
    expect(positionReads()).toBe(0);
    expect(permissionRequests()).toBe(0);
  });

  it("offers the check in the picker with the spec's explanation, and keeps only a near result", async () => {
    setLocationPermission("undetermined");
    setDevicePosition(FAR);
    await openMeeting("2026-10-05T17:10:00Z");
    await fireEvent.press(screen.getByRole("button", { name: "Tag this meeting" }));
    expect(screen.getByText(EXPLANATION)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Check I'm near the meeting" }));
    expect(
      await screen.findByText("You don't seem to be at the meeting, so your tags will go without that."),
    ).toBeOnTheScreen();
    expect(permissionRequests()).toBe(1);
    expect(await wasNear(ID, new Date(STARTED))).toBe(false);
    setDevicePosition(NEAR);
    await fireEvent.press(screen.getByRole("button", { name: "Check I'm near the meeting" }));
    expect(await screen.findByText("You're near the meeting. Your tags will say so.")).toBeOnTheScreen();
    expect(await wasNear(ID, new Date(STARTED))).toBe(true);
  });

  it("sends nearMeeting false without a check, and for an online meeting never offers one", async () => {
    api.reply(PATH, {
      meeting: meeting({
        attendance: "online",
        latitude: null,
        longitude: null,
        conferenceUrl: "https://zoom.us/j/1",
      }),
    });
    api.reply("/api/v1/tags", { meetingId: ID, tags: COUNTS }, 201, "POST");
    await openMeeting("2026-10-05T17:10:00Z");
    await fireEvent.press(screen.getByRole("button", { name: "Tag this meeting" }));
    expect(screen.queryByText(EXPLANATION)).toBeNull();
    await choose("Quiet");
    await fireEvent.press(screen.getByRole("button", { name: "Send my tags" }));
    await screen.findByText("Thanks. Your tags are added.");
    expect(tagWrites()[0]?.body).toBe(`{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":false}`);
  });

  it("keeps no position on the phone, only that the check said near", async () => {
    setLocationPermission("granted");
    setDevicePosition(NEAR);
    await openMeeting("2026-10-05T17:10:00Z");
    await waitFor(async () => {
      expect(await wasNear(ID, new Date(STARTED))).toBe(true);
    });
    const db = await appDatabase();
    expect(await db.getAllAsync("select * from attendance_checks", [])).toEqual([
      { meeting_id: ID, occurrence_start: new Date(STARTED).getTime() },
    ]);
  });
});
```

Import `positionReads`, `wasNear` (`@/tagging/attendance-record`) and `appDatabase` alongside the rest. Every POST body in `tag-meeting.test.tsx` and `edit-tags.test.tsx` gains `,"nearMeeting":false` before the closing brace.

Extend `meeting-detail.test.tsx`'s merged-meeting test (Review Focus 3): before rendering, `await recordNear(ID, new Date("2026-10-05T17:00:00Z"))`. After the page follows the survivor, expect `await wasNear(SURVIVOR, new Date("2026-10-05T17:00:00Z"))` to be `true` and `await wasNear(ID, …)` to be `false`.

- [ ] **Step 7: Watch them fail.** `pnpm --filter mobile test attendance-check tag-meeting edit-tags`. Expected: FAIL (no check, and old bodies).

- [ ] **Step 8: Wire it in.**
  - **`src/tagging/use-attendance-check.ts`:**

```ts
import type { MeetingSummary } from "@mymeetingapp/shared";
import { useFocusEffect } from "expo-router";
import { useCallback } from "react";

import { useFeatures } from "@/config/upgrade";
import { checkAttendance } from "@/location/attendance";
import { recordNear, wasNear } from "@/tagging/attendance-record";
import { attendanceOccurrence, checkablePlace } from "@/tagging/window";

// Spec §8: opening a meeting's page during its time, with location already allowed, checks proximity on the phone.
// Silent: no dialog, nothing shown, best effort. Only a "near" result is kept.
export function useAttendanceCheck(meeting: MeetingSummary): void {
  const { tagging } = useFeatures();
  useFocusEffect(
    useCallback(() => {
      const place = checkablePlace(meeting);
      if (!tagging || meeting.tagsDisabled || place === null || meeting.timezone === null) return;
      const occurrence = attendanceOccurrence({ ...meeting, timezone: meeting.timezone }, new Date());
      if (occurrence === null) return;
      void (async () => {
        if (await wasNear(meeting.id, occurrence.start)) return;
        if ((await checkAttendance(place, "open")) === "near") await recordNear(meeting.id, occurrence.start);
      })().catch(() => undefined);
    }, [meeting, tagging]),
  );
}
```

Call it in `MeetingInfo`.

- **`src/ui/attendance-offer.tsx`:** shows the spec's explanation and a `<Button kind="secondary" label="Check I'm near the meeting" hint="Uses your location once, on this phone">`. Pressing it runs `checkAttendance(place, "tap")`, then `recordNear` on "near", and shows the answer's line as an alert:

```ts
const ANSWERS: Record<AttendanceAnswer, string> = {
  near: "You're near the meeting. Your tags will say so.",
  notNear: "You don't seem to be at the meeting, so your tags will go without that.",
  denied: "Location isn't allowed for mymeetingapp, so your tags will go without the check.",
  approximate: "Only your approximate location is shared, so your tags will go without the check.",
  unavailable: "Your phone couldn't find where it is, so your tags will go without the check.",
};
```

When `wasNear` already holds for the occurrence, it shows the "near" line and no button.

- **`YourTags`:** in "new" mode, renders `<AttendanceOffer>` as the panel's child when `checkablePlace(meeting)` and `attendanceOccurrence(…, now)` both exist. `submit` sends `nearMeeting`: `false` for an online meeting or a meeting with no zone, else `await wasNear(meeting.id, lastOccurrence({ ...meeting, timezone }, new Date()).start)`.
- **`src/api/writes.ts`'s `submitTags`:** unchanged; it parses the request, which now carries `nearMeeting`.

- [ ] **Step 9: Run.** `pnpm --filter mobile test`. Expected: PASS, the whole suite.

- [ ] **Step 10: Standards.** In "Location and places in the app", add: "`checkAttendance(place, "tap" | "open")` from `@/location/attendance` for the attendance check: `"open"` never shows a dialog and needs location already allowed and precise; `"tap"` may ask for permission, then temporary full accuracy (iOS, purpose key `AttendanceCheck`) or precise location (Android). Only its answer leaves `src/location`." Then commit:

```bash
git add apps/mobile docs/standards.md
git commit -m "feat(mobile): the attendance check, kept on the phone and sent only as nearMeeting"
```

---

### Task 7: Suggesting a tag

Spec §5: "Users can suggest a new word (2–40 characters, 5 per device per day)." The suggestion is offered in the tag panel, behind `features.suggestions`. The server screens it with AI and never says what was decided, so the person sees a thank-you (decision 5).

**Files:**

- Create: `apps/mobile/src/ui/suggest-tag.tsx`, `apps/mobile/test/suggest-tag.test.tsx`
- Modify: `apps/mobile/src/api/writes.ts`, `apps/mobile/src/ui/your-tags.tsx` (render it in the panel), `SPEC.md` §8, `docs/standards.md`

**Interfaces:**

- Consumes: `SuggestionRequest`, `SuggestionResponse`, `TagLabelText` from shared; `writeFailure`; `useFeatures`.
- Produces: `suggestTag(text: string): Promise<SuggestionResponse>` from `@/api/writes`; `<SuggestTag />` from `@/ui/suggest-tag`.

- [ ] **Step 1: Failing tests.** Create `apps/mobile/test/suggest-tag.test.tsx`. Its setup is `tag-meeting.test.tsx`'s, and each test opens the picker at `STARTED` first.

```tsx
const SUGGEST = "/api/v1/suggestions";
const THANKS = "Thanks. We'll review it, and if it's added, it'll appear in the list for everyone.";

async function suggest(text: string) {
  await fireEvent.press(screen.getByRole("button", { name: "Suggest a tag" }));
  await fireEvent.changeText(screen.getByLabelText("Your suggested tag"), text);
  await fireEvent.press(screen.getByRole("button", { name: "Send suggestion" }));
}

describe("Suggest a tag", () => {
  it("sends only the trimmed words and says thanks, never what the screening decided", async () => {
    api.reply(SUGGEST, { status: "received" }, 202, "POST");
    await openPicker();
    await suggest("  Candlelight  ");
    expect(await screen.findByText(THANKS)).toBeOnTheScreen();
    const [sent] = api.requests.filter((r) => r.path === SUGGEST);
    expect(sent?.body).toBe('{"text":"Candlelight"}');
    expect(sent?.headers["x-device-id"]).toBeDefined();
    expect(screen.getByLabelText("Your suggested tag")).toHaveProp("value", "");
  });

  it.each(["x", "a".repeat(41), "<b>bold</b>", "https://x.y"])(
    "checks %p on the phone and sends nothing",
    async (text) => {
      await openPicker();
      await suggest(text);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Use 2 to 40 letters or numbers (spaces, apostrophes, hyphens and & are fine).",
      );
      expect(api.requests.filter((r) => r.path === SUGGEST)).toEqual([]);
    },
  );

  it("shows the server's words at the daily limit", async () => {
    api.reply(
      SUGGEST,
      {
        error: { code: "rate_limited", message: "You've reached today's limit. Please try again tomorrow." },
      },
      429,
      "POST",
    );
    await openPicker();
    await suggest("Candlelight");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You've reached today's limit. Please try again tomorrow.",
    );
  });

  it("says it can't tell whether the suggestion arrived when the server can't be reached", async () => {
    await openPicker();
    await suggest("Candlelight");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't reach mymeetingapp, so we can't tell whether your suggestion arrived. Try again.",
    );
  });

  it("isn't offered while suggestions are switched off", async () => {
    api.reply("/api/v1/config", { ...CONFIG, features: { tagging: true, suggestions: false } });
    await openPicker();
    expect(screen.queryByRole("button", { name: "Suggest a tag" })).toBeNull();
  });
});
```

Here `openPicker()` is `await openMeeting(); await fireEvent.press(screen.getByRole("button", { name: "Tag this meeting" }));`.

- [ ] **Step 2: Watch them fail.** `pnpm --filter mobile test suggest-tag`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`writes.ts`:** `export const suggestTag = (text: string) => sendWrite(SuggestionResponse, "POST", "/api/v1/suggestions", SuggestionRequest.parse({ text }));`.
  - **`src/ui/suggest-tag.tsx`:**
    - Shows a `<Button kind="text" label="Suggest a tag" hint="Suggest a word that isn't in the list">`.
    - Pressing it reveals a `TextInput` (`accessibilityLabel="Your suggested tag"`, `maxLength={60}`, the theme's text colour and border, `minHeight: 44`), the helper line "We review every suggestion. Don't include names or anything that could identify someone.", and `<Button label="Send suggestion">`.
    - On send:
      - `TagLabelText.safeParse(text)` failing shows the local message, with no request;
      - otherwise `suggestTag(text)`; success clears the field and shows `THANKS`; failure shows `writeFailure(error, "We couldn't reach mymeetingapp, so we can't tell whether your suggestion arrived. Try again.")`;
      - every result is an `alert`, and is announced.
    - The suggestion text is held in component state only, never saved.
  - **`YourTags`:** renders `<SuggestTag />` as a panel child when `features.suggestions`, after the attendance offer.
  - **`SPEC.md` §5, Suggestions:** append "The app shows only a thank-you; the screening's decision is never returned (2026-10-01)."
  - **`docs/standards.md` "Tagging a meeting":** add "Suggestions: `<SuggestTag>` in the panel, checked with the shared `TagLabelText` before sending."

- [ ] **Step 4: Run.** `pnpm --filter mobile test suggest-tag tag-meeting`. Expected: PASS.

- [ ] **Step 5: Commit.** `pnpm check`, then:

```bash
git add apps/mobile SPEC.md docs/standards.md
git commit -m "feat(mobile): suggest a tag from the picker"
```

---

### Task 8: The network audit checks writes

Until now the audit treated any device header as a finding and allowed only the five reads plus search (finding 7). Each write now gets the same byte-exact treatment as search, and device headers are allowed on writes only, each held to its shared shape.

**Files:**

- Modify: `tools/network-audit/src/audit.ts`, `tools/network-audit/src/headers.ts`, `tools/network-audit/src/main.ts`, `tools/network-audit/test/audit.test.ts`, `tools/network-audit/test/headers.test.ts`, `tools/network-audit/test/main.test.ts`, `docs/mobile.md`

**Interfaces:**

- Consumes: `TagSubmissionRequest`, `TagEditRequest`, `SuggestionRequest`, `WriteHeaders`, `DEVICE_HEADERS` from shared.
- Produces: `HeaderContext.write: boolean`; `AuditReport.writeRequests: number`. `main.ts` prints "Writes checked: N".

- [ ] **Step 1: Failing tests.** Add to `tools/network-audit/test/audit.test.ts`, using its existing HAR entry builders (`entry({ method, url, headers, postData, bodySize })` or their local equivalents):

```ts
const WRITE_HEADERS = [
  { name: "X-Device-Id", value: "6F9619FF-8B86-D011-B42D-00C04FC964FF" },
  { name: "X-Platform", value: "ios" },
  { name: "X-App-Version", value: "0.1.0" },
];
const TAG_BODY = `{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":true}`;

describe("writes", () => {
  it("passes each of the app's writes with the device headers and exactly its contract's body", () => {
    const report = auditHar(
      har([
        search(),
        post("/api/v1/tags", TAG_BODY, WRITE_HEADERS),
        put(`/api/v1/tags/${ID}`, '{"tags":["quiet"]}', WRITE_HEADERS),
        del(`/api/v1/tags/${ID}`, WRITE_HEADERS),
        post("/api/v1/tags/delete-mine", null, WRITE_HEADERS),
        post("/api/v1/suggestions", '{"text":"Candlelight"}', WRITE_HEADERS),
      ]),
      OPTIONS,
    );
    expect(report.findings).toEqual([]);
    expect(report.writeRequests).toBe(5);
  });

  it.each([
    ["an extra field", `{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":true,"lat":36.16}`],
    ["a coordinate for nearMeeting", `{"meetingId":"${ID}","tags":["quiet"],"nearMeeting":36.16}`],
    ["a duplicate key", `{"meetingId":"${ID}","tags":["quiet"],"tags":["quiet"]}`],
    ["different spacing", `{ "meetingId":"${ID}","tags":["quiet"]}`],
  ])("fails a tag body with %s", (_what, body) => {
    expect(problems(post("/api/v1/tags", body, WRITE_HEADERS))).toContain(
      "write body isn't exactly what the app sends",
    );
  });

  it("fails a write missing a device header", () => {
    expect(problems(post("/api/v1/tags", TAG_BODY, WRITE_HEADERS.slice(1)))).toContain(
      "write without the x-device-id header",
    );
  });

  it("still fails a device header on a read", () => {
    expect(problems(get("/api/v1/vocabulary", WRITE_HEADERS))).toContain(
      "sends the device header X-Device-Id",
    );
  });

  it("fails X-Attestation until Phase 6 turns it on", () => {
    expect(
      problems(post("/api/v1/tags", TAG_BODY, [...WRITE_HEADERS, { name: "X-Attestation", value: "abc" }])),
    ).toContain("sends X-Attestation, which isn't switched on yet");
  });

  it("fails a malformed device ID", () => {
    expect(
      problems(
        post("/api/v1/tags/delete-mine", null, [
          { name: "X-Device-Id", value: "36.162749" },
          ...WRITE_HEADERS.slice(1),
        ]),
      ),
    ).toContain("sends an unexpected value for the X-Device-Id header");
  });

  it("fails a body on a write that has none", () => {
    expect(problems(del(`/api/v1/tags/${ID}`, WRITE_HEADERS, '{"x":1}'))).toContain(
      "sends a body on a write that has none",
    );
  });

  it("fails a capture holding two device IDs", () => {
    const other = [{ name: "X-Device-Id", value: "dd96dec43fb81c97" }, ...WRITE_HEADERS.slice(1)];
    const report = auditHar(
      har([
        search(),
        post("/api/v1/tags/delete-mine", null, WRITE_HEADERS),
        post("/api/v1/tags/delete-mine", null, other),
      ]),
      OPTIONS,
    );
    expect(report.findings).toContainEqual({
      request: "(capture)",
      problem: "sends more than one device ID",
    });
  });

  it("fails a write path or method the app never uses", () => {
    expect(problems(put("/api/v1/tags", TAG_BODY, WRITE_HEADERS))).toContain(
      "isn't one of the app's requests",
    );
  });
});
```

`problems(entry)` returns the findings' `problem`s for a capture of `[search(), entry]`. In `headers.test.ts`, add:

- `Content-Type` is allowed on a PUT with a body and refused on a bodiless POST;
- `Content-Length: 0` is allowed only on a bodiless write.

Change every existing expectation of "isn't one of the app's read requests" to "isn't one of the app's requests".

- [ ] **Step 2: Watch them fail.** `pnpm --filter network-audit test`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - **`audit.ts`:** add

```ts
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// Phase 5b's writes, each with exactly the body the app sends (JSON.stringify of its contract's parse), or none.
const WRITES: { method: string; path: RegExp; body: z.ZodType | null }[] = [
  { method: "POST", path: /^\/api\/v1\/tags$/, body: z.strictObject(TagSubmissionRequest.shape) },
  {
    method: "PUT",
    path: new RegExp(`^/api/v1/tags/${UUID}$`, "i"),
    body: z.strictObject(TagEditRequest.shape),
  },
  { method: "DELETE", path: new RegExp(`^/api/v1/tags/${UUID}$`, "i"), body: null },
  { method: "POST", path: /^\/api\/v1\/tags\/delete-mine$/, body: null },
  { method: "POST", path: /^\/api\/v1\/suggestions$/, body: z.strictObject(SuggestionRequest.shape) },
];
const REQUIRED_DEVICE_HEADERS = [
  DEVICE_HEADERS.deviceId,
  DEVICE_HEADERS.platform,
  DEVICE_HEADERS.appVersion,
].map((n) => n.toLowerCase());
```

In the loop, find `write` before the header checks and pass `write: write !== undefined` into `headerFinding`'s context. Collect `x-device-id` values into a `deviceIds` set. Then replace the request-shape branch: - search keeps its check; - a write is checked for each missing required header, and either for `hasAnyBody` (when `body` is null) or for `!isExactly(write.body, request)` (the generalized `isExactlyTheAppsSearchBody`), which gives "write body isn't exactly what the app sends"; - anything else that isn't a GET read is "isn't one of the app's requests"; - the body check for non-POST methods applies only to non-writes.

After the loop, more than one device ID adds `{ request: "(capture)", problem: "sends more than one device ID" }`. The device ID itself is never printed. Count `writeRequests`.

- **`headers.ts`:** `HeaderContext` gains `write: boolean`. A device header on a non-write keeps its finding. On a write:
  - `x-attestation` gives "sends X-Attestation, which isn't switched on yet";
  - the others must pass `WriteHeaders.shape.deviceId`, `.platform` or `.appVersion`.

`content-type` becomes `(value, ctx) => (ctx.method === "POST" || ctx.method === "PUT") && (ctx.bodySize ?? 0) > 0 && value === "application/json"`, and `content-length` becomes `(value, ctx) => value === String(ctx.bodySize ?? 0) && ((ctx.bodySize ?? 0) > 0 || ctx.write)`.

- **`main.ts`:** prints `Writes checked: ${report.writeRequests}` after the request count. Pin it in `main.test.ts`.
- **`docs/mobile.md` "Proxy audit":** update the header list:
  - `Content-Type` on POST and PUT with a body;
  - `Content-Length: 0` only on a bodiless write;
  - the three device headers on writes only, with their shapes;
  - `X-Attestation` a finding until Phase 6;
  - one device ID per capture.

Add a "Writes" bullet listing the five write shapes and their byte-exact bodies.

- [ ] **Step 4: Run.** `pnpm --filter network-audit test`. Expected: PASS.

- [ ] **Step 5: Commit.** `pnpm check`, then:

```bash
git add tools/network-audit docs/mobile.md
git commit -m "feat(network-audit): check the app's writes and allow device headers on them only"
```

---

### Task 9: Two minors carried over from 5a

The carry-over file lists two deferred minors:

- web lock-holder tests leave a connection and its locks behind if they fail mid-way;
- a search still in flight during "Clear recent places" can save its typed label afterwards.

Both are small, and both sit near code 5b already touches: the tag-write tests and the phone's personal data.

**Files:**

- Create: `apps/web/test/db-helpers.test.ts`
- Modify: `apps/web/test/db.ts`, `apps/web/test/delete-mine-route.test.ts`, `apps/web/test/tags-route.test.ts`, `apps/mobile/src/cache/store.ts`, `apps/mobile/test/offline-cache.test.tsx`

**Interfaces:**

- Produces:
  - `whileHolding<T>(lock: string, params: unknown[], during: (holder: { pid: number; query: (text: string, params?: unknown[]) => Promise<unknown> }) => Promise<T>): Promise<T>` from `apps/web/test/db.ts`;
  - `forgetLastSearch(db)` also stamps `settings.searches_forgotten_at`, and `writeSearchResult` skips a result fetched before that stamp.

- [ ] **Step 1: Failing web test.** Create `apps/web/test/db-helpers.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";

import { pool } from "@/db/client";

import { whileHolding } from "./db";

afterAll(async () => {
  await pool.end();
});

describe("whileHolding", () => {
  it("frees its connection and its locks when the test body throws", async () => {
    const idleBefore = pool.idleCount;
    await expect(
      whileHolding("select pg_advisory_xact_lock(424242)", [], () =>
        Promise.reject(new Error("assertion failed")),
      ),
    ).rejects.toThrow("assertion failed");
    const other = await pool.connect();
    try {
      const { rows } = await other.query<{ got: boolean }>("select pg_try_advisory_lock(424242) as got");
      expect(rows).toEqual([{ got: true }]);
      await other.query("select pg_advisory_unlock(424242)");
    } finally {
      other.release();
    }
    expect(pool.idleCount).toBeGreaterThanOrEqual(idleBefore);
  });
});
```

Run `pnpm --filter web exec vitest run db-helpers`. Expected: FAIL, `whileHolding` isn't exported.

- [ ] **Step 2: The helper, and its five uses.** Add to `apps/web/test/db.ts` (importing `pool` from `@/db/client`):

```ts
// Holds the locks `lock` takes, in a transaction on its own connection, while `during` starts the racing work and
// waits for it to queue. Then it commits and returns the connection, even when `during` throws, so a failing test can
// never leave a lock or a checked-out connection behind for the next one. `during` must return before the racing
// work is awaited (return it inside an object), or it would wait on the lock this holds.
export async function whileHolding<T>(
  lock: string,
  params: unknown[],
  during: (holder: {
    pid: number;
    query: (text: string, params?: unknown[]) => Promise<unknown>;
  }) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query("begin");
    await client.query(lock, params);
    const result = await during({
      pid: await backendPid(client),
      query: (text, values) => client.query(text, values),
    });
    await client.query("commit");
    committed = true;
    return result;
  } finally {
    if (!committed) await client.query("rollback").catch(() => undefined);
    client.release();
  }
}
```

Rewrite each hand-rolled holder in `tags-route.test.ts` (the `admin` and `holder` blocks) and `delete-mine-route.test.ts` (the `screening` block and the two `holder` blocks) with it. For example, the blocked-device test becomes:

```ts
const { write } = await whileHolding(
  "select pg_advisory_xact_lock(hashtextextended($1, 0))",
  [DEVICE_A_HASH],
  async (holder) => {
    let settled = false;
    const write = post({ meetingId, tags: ["quiet"] }).finally(() => (settled = true));
    await untilWaitingOnLock(holder.pid, () => settled);
    await holder.query("update devices set blocked = true where device_hash = $1", [DEVICE_A_HASH]);
    return { write };
  },
);
await expectError(await write, 403, "device_blocked");
```

Run `pnpm --filter web exec vitest run db-helpers tags-route delete-mine-route`. Expected: PASS.

- [ ] **Step 3: Failing mobile test.** Add to `apps/mobile/test/offline-cache.test.tsx`:

```tsx
it("never saves a search that was asked for before Clear recent places", async () => {
  // This file's searchRead(key) is a "search"-kind read over the vocabulary path; answerLater plays a slow server.
  const answer = api.answerLater("/api/v1/vocabulary");
  const reading = cachedRead(searchRead("search:35.76,-83.97,25"));
  await waitFor(() => {
    expect(api.requests.some((r) => r.path === "/api/v1/vocabulary")).toBe(true);
  });
  await forgetRecentPlaces();
  answer(VOCABULARY);
  expect(await reading).toEqual({ data: VOCABULARY, savedAt: null });
  expect(await readCache("search:35.76,-83.97,25")).toBeNull();
});
```

Import `waitFor` from RNTL and `forgetRecentPlaces` from `@/location/recent-places`. Run `pnpm --filter mobile test offline-cache`. Expected: FAIL; the late search is saved.

- [ ] **Step 4: The stamp.** In `src/cache/store.ts`:

```ts
// "Clear recent places" stamps when it forgot the last search, so a search asked for before then (still in flight)
// can't save its typed label afterwards.
const FORGOTTEN_AT = "searches_forgotten_at";
const Stamp = z.object({ value: z.string() });

export async function forgetLastSearch(db: AppDatabase): Promise<void> {
  await db.runAsync("delete from cache_entries where key like 'search:%'", []);
  await db.runAsync("insert or replace into settings (key, value) values (?, ?)", [
    FORGOTTEN_AT,
    String(Date.now()),
  ]);
}
```

At the top of `writeSearchResult`'s transaction:

```ts
const stamp = await db.getFirstAsync("select value from settings where key = ?", [FORGOTTEN_AT]);
if (stamp !== null && savedAt.getTime() < Number(Stamp.parse(stamp).value)) return;
```

Run `pnpm --filter mobile test offline-cache me-tab nearby`. Expected: PASS. In `docs/standards.md` "Location and places in the app", add "(and stamps when, so a search already in flight is never saved afterwards)" after "`forgetLastSearch(db)`".

- [ ] **Step 5: Commit.** `pnpm check`, then:

```bash
git add apps/web/test apps/mobile/src/cache/store.ts apps/mobile/test/offline-cache.test.tsx docs/standards.md
git commit -m "test(web): one lock holder that always lets go; fix(mobile): no late search after Clear recent places"
```

---

### Task 10: The Android pass — Maps key, EAS environments and an Android build

Owner decision 3. The app already reads `GOOGLE_MAPS_ANDROID_API_KEY` in `app.config.ts` (5a Task 9). This task gets the key to every build without committing it, pins which EAS environment each profile reads, and runs the first Android dev build.

**Files:**

- Modify: `apps/mobile/eas.json`, `apps/mobile/test/eas-profiles.test.ts`, `apps/mobile/.env.example`, `docs/mobile.md`

- [ ] **Step 1: Failing profile test.** Add to `eas-profiles.test.ts`:

```ts
it("reads each profile's variables (the Google Maps key among them) from its own EAS environment", () => {
  const { build } = EasJson.parse(JSON.parse(readFileSync(path.join(__dirname, "../eas.json"), "utf8")));
  expect(build.development?.environment).toBe("development");
  expect(build.testflight?.environment).toBe("preview");
  expect(build.production?.environment).toBe("production");
});
```

Extend `EasJson`'s profile object with `environment: z.string().optional()`. Run `pnpm --filter mobile test eas-profiles`. Expected: FAIL.

- [ ] **Step 2: `eas.json`.** Add `"environment": "development"` to `development`, `"environment": "preview"` to `testflight`, and `"environment": "production"` to `production`. Run the test again. Expected: PASS. Then run `cd apps/mobile && pnpm dlx eas-cli@24.8.0 config --platform android --profile development | grep -i environment`. Expected: `development`.

- [ ] **Step 3 (Owner): the Maps key.**
  1. In Google Cloud Console, create (or pick) a project with billing, and enable **Maps SDK for Android**.
  2. Get the SHA-1 fingerprints:
     - **EAS's Android keystore:** run `cd apps/mobile && pnpm dlx eas-cli@24.8.0 credentials -p android`, choose the development profile, and let EAS create the keystore if asked. It shows the SHA-1.
     - **The local debug keystore,** for `expo run:android`: `keytool -list -v -alias androiddebugkey -storepass android -keypass android -keystore ~/.android/debug.keystore | grep SHA1`.
     - Phase 6 adds Play App Signing's SHA-1.
  3. Create an API key with these restrictions:
     - **Application restrictions:** Android apps, package `com.goodersoftware.mymeetingapp`, with each SHA-1;
     - **API restrictions:** Maps SDK for Android only.
  4. Store it in EAS, never in git: `pnpm dlx eas-cli@24.8.0 env:create --name GOOGLE_MAPS_ANDROID_API_KEY --environment development --environment preview --environment production --visibility secret` (paste the value when asked).
  5. For local builds, add `GOOGLE_MAPS_ANDROID_API_KEY=<key>` to `apps/mobile/.env`. It is git-ignored; Expo CLI loads it before evaluating `app.config.ts`.

Claude adds `GOOGLE_MAPS_ANDROID_API_KEY=` (empty) with a comment to `.env.example`.

- [ ] **Step 4 (Claude): an Android dev build on the emulator.**
  1. In Android Studio's Device Manager, create an API 33 "Google APIs" image (not "Google Play"); Task 11's audit needs it writable.
  2. Start it, then `cd apps/mobile && EXPO_NO_TELEMETRY=1 npx expo run:android`.
  3. Set the emulator's location: `adb emu geo fix -86.781602 36.162749` (longitude first).
  4. Check, then record in `docs/mobile.md`'s smoke table:
     - the map draws Google tiles;
     - "Maryville, TN" finds meetings with location off;
     - "Use my location" shows Android's dialog;
     - a meeting page's Directions open Google Maps.
- [ ] **Step 5 (Owner, optional): the owner's Android phone.** `pnpm dlx eas-cli@24.8.0 build --profile development --platform android` produces an installable APK. Install it from the build page.
- [ ] **Step 6: Docs and commit.** `docs/mobile.md` gets "## Android builds":
  - the key's restrictions, and where it lives (EAS secret, `.env`);
  - the SHA-1 commands;
  - the emulator image;
  - `expo run:android`;
  - `adb emu geo fix`.

  Then `pnpm check`, and:

```bash
git add apps/mobile/eas.json apps/mobile/test/eas-profiles.test.ts apps/mobile/.env.example docs/mobile.md
git commit -m "chore(mobile): EAS environments per profile and the Android build runbook"
```

---

### Task 11: Device runs — TestFlight against staging, smoke, accessibility, both audits, then the PR

The runs below test the real app against staging only (Global Constraints: no test tag reaches production). Results go into `docs/mobile.md`.

**Files:** Modify `docs/mobile.md` (smoke table, accessibility, audit log), `docs/deploy.md` (Task 1's results), `docs/superpowers/plans/2026-09-26-roadmap.md`.

- [ ] **Step 1: End-of-phase checks.**
  - Run `pnpm check`, `pnpm knip:production` and `pnpm --filter web test:e2e`. Expected: all pass.
  - Run `pnpm --filter mobile exec expo install --check` (online; it should say up to date) and `pnpm --filter mobile dlx expo-doctor` (no failed checks).
  - Confirm Task 1's PR is merged and its workflow has run green at least once.
- [ ] **Step 2 (Claude): the TestFlight build.** The native module changed (Task 6), so this is a new binary. EAS holds an App Store Connect API key from earlier submits, so this needs no Apple sign-in:

```bash
cd apps/mobile && pnpm dlx eas-cli@24.8.0 build --platform ios --profile testflight --auto-submit --non-interactive
```

Expected: it finishes and is submitted. Testers install it from TestFlight once it's processed.

- [ ] **Step 3: Tagging smoke checklist (owner's iPhone, TestFlight; repeated on the iOS simulator with a dev build pointed at staging).** Delete the app first. Record each result in the smoke table. Pick a staging meeting near Maryville, TN that is in its tagging window now: one that started in the last few hours.
  1. **Meeting page in its window.** "Tag this meeting" shows; outside the window there's the "You can add tags…" line.
     - Choose 2 tags and Send. The counts show the new tags at once ("… 1"), and "Your tags: …" and "Added <today>" appear.
  2. **A second phone** (the simulator) tags the same meeting with the same tag: its count shows 2, once per device (spec §14).
  3. **Edit my tags:** change one tag and Save; the counts follow. **Remove my tags:** it asks first, then the record is gone and the counts drop.
  4. **Tag again within 7 days.** On the simulator, delete the app (its record goes, but the Keychain ID stays) and reinstall, then tag the same meeting. The app shows "You've already tagged this meeting in the last 7 days…" and offers to save as an edit; saving works and "Your tags" returns.
  5. **Attendance.**
     - With location allowed, open an in-person meeting during its time at the venue; or on the simulator, set the location to the meeting's coordinates with `xcrun simctl location booted set <lat>,<lng>`.
     - Tag it. Staging's `tag_counts.verified_count` for that tag is 1 (Neon SQL editor on the `staging` branch: `select device_count, verified_count from tag_counts where meeting_id = '<id>'`).
     - With precise location turned off for the app, the panel's check shows the one-time full-accuracy prompt with the purpose string.
  6. **Suggest a tag:** "Candlelight" shows the thank-you. `/metrics/suggestions` on staging lists it.
  7. **Me tab:** "Meetings I've tagged" lists the meetings; tapping one opens it. **"Delete all my tags":** it asks, then says how many it deleted, and the list empties.
     - Staging SQL: `select count(*) from tag_submissions` drops by that many, and `select count(*) from tag_audit` has none left for those meetings.
  8. **Offline:** in Airplane Mode, Send says it can't tell whether the tags were saved, and "Delete all my tags" says it didn't finish. Nothing on the phone changes.
  9. **Below minimum version:** run a local web with `MIN_VERSION_IOS=9.0.0` (5a smoke step 11's setup). "Tag this meeting" and "Edit my tags" are replaced by the update line; Remove and "Delete all my tags" still work.
  10. **Android emulator** (Task 10's build, `.env` pointed at staging): steps 1, 3, 5 and 7. The panel's check on a coarse-only permission shows Android's precise-location upgrade.
- [ ] **Step 4: Accessibility pass.** Record the results in `docs/mobile.md`.
  - **VoiceOver on the iPhone**, through the picker:
    - category headers read as headings;
    - each tag reads as "checkbox, checked" or "not checked";
    - "2 of 6 chosen" is read;
    - the 6-tag limit, refusals and results are announced;
    - "Remove my tags" and "Delete all my tags" announce their questions.
  - **Largest Dynamic Type:** the pills wrap, and nothing clips.
  - **TalkBack on the emulator:** the same path.
- [ ] **Step 5: Network audits, with writes.** Follow `docs/mobile.md`'s "Network audit" steps (5a runbook), with these differences:
  - **iOS simulator, Release build pointed at staging:**
    - Build with `EXPO_PUBLIC_SERVER_URL=https://mymeetingapp-staging.vercel.app npx expo run:ios --configuration Release`.
    - Exercise every write: tag, edit, remove, suggest, delete-all; plus the attendance check at the canary location (`xcrun simctl location booted set 36.162749,-86.781602`, against a meeting there, if one is in its window).
    - Run the audit:

```bash
pnpm --filter network-audit check-har --har "$HOME/mma-audit-5b-sim.har" --server mymeetingapp-staging.vercel.app \
  --private 2011-04-17 --private "Apr 17, 2011" --search-text "Maryville, TN 37804" --search-text "37804" \
  --exact 36.162749,-86.781602
```

    - Expected: PASS, with "Writes checked" at least 5 and one user agent.

- **Android emulator (API 33 Google APIs), Release build:**
  1. Install mitmproxy's CA as a system certificate (mitmproxy docs, "Install System CA Certificate on Android Emulator"):

```bash
emulator -avd <api33> -writable-system &
adb wait-for-device && adb root && adb shell avbctl disable-verification && adb reboot && adb wait-for-device && adb root && adb remount
H="$(openssl x509 -inform PEM -subject_hash_old -in ~/.mitmproxy/mitmproxy-ca-cert.pem | head -1)"
cp ~/.mitmproxy/mitmproxy-ca-cert.pem "$TMPDIR/$H.0" && adb push "$TMPDIR/$H.0" /system/etc/security/cacerts/ \
  && adb shell chmod 664 "/system/etc/security/cacerts/$H.0" && adb reboot
```

    2. Build and install `EXPO_PUBLIC_SERVER_URL=https://mymeetingapp-staging.vercel.app npx expo run:android --variant release`.
    3. Set the proxy with `adb shell settings put global http_proxy 10.0.2.2:8080`, and the canary with `adb emu geo fix -86.781602 36.162749`.
    4. Exercise the same writes, then clear the proxy (`adb shell settings put global http_proxy :0`).
    5. Run the same audit command on its HAR. Expected: PASS; the user agent is `okhttp/<x.y.z>`.

- Record both in the audit log, with the other hosts seen, then delete the HAR files.
- [ ] **Step 6: Spec §14 rows, checked end to end.** Note each in `docs/mobile.md` and in the PR:
  - **"Tagging outside the window, a second new submission within 7 days, or unknown tags are rejected with a clear message":** smoke 1 and 4; `tag-meeting.test.tsx`'s refusals.
  - **"Editing and deleting tags works any time after the window closes, and counts update in the response":** smoke 3; `edit-tags.test.tsx`.
  - **"A new tag appears on a meeting immediately with a count of 1, and the count increases once per distinct device":** smoke 1–2.
  - **"Tag rows for two meetings tagged by the same device have different submitter IDs":** after smoke 1 on two meetings from one phone, staging SQL `select meeting_id, submitter_id from tag_submissions` shows two different `submitter_id`s. The 7-day half is the maintenance workflow (Task 1) plus Phase 3's tests.
  - **"`delete-mine` removes every tag … and counts update":** smoke 7.
  - **"Sobriety date, favorites, the local tag record … never appear in network traffic":** both audits (the write bodies are byte-exact, with no record fields) and `writes.test.ts`.
  - **"With location allowed … the only coordinates in network traffic are rounded":** both audits, with the exact canary.
- [ ] **Step 7: Roadmap and docs.**
  - Roadmap, Phase 5: "5b (`2026-10-01-phase-5b-mobile-tagging.md`): device ID, write client, tagging, edit/remove, attendance check, local record, suggestions, Delete all my tags, staging maintenance, Android pass."
  - In the acceptance table, add "5b" to the rows it closed.
  - Add Task 1's staging results to `docs/deploy.md`.
  - Commit with `docs(mobile): 5b smoke, accessibility and audit results`.
- [ ] **Step 8: Open the PR.** Push `phase-5b-mobile` and open a PR against `main`. The description lists the smoke, accessibility and audit results and the §14 mapping, and ends with the PR attribution line. CI must be green.

---

## Done when

- `pnpm check`, `pnpm knip:production` and `pnpm --filter web test:e2e` pass, and CI is green.
- Staging runs `main`'s code, its nightly maintenance has run green from GitHub Actions, and a curl write-path check passed (Task 1).
- On the owner's iPhone (TestFlight, staging), the simulator and the Android emulator:
  - tagging, editing, removing, the attendance check, suggesting, "Meetings I've tagged" and "Delete all my tags" pass the smoke checklist;
  - the accessibility pass is recorded.
- Both audits PASS with writes exercised: device headers only on writes, byte-exact write bodies, one device ID, rounded coordinates only in search bodies.
- Every Phase 5 row of spec §14 is checked end to end (Task 11 Step 6).
- Owner decisions honoured: 1 (staging maintenance), 2 (Neon cleanup, if approved), 3 (Android in 5b), 4 (device ID, no rotation, support FAQ), 5 ("Tag this meeting"), 6 (what Delete all clears), 7 ("Me tab" on the website).
- Still open after 5b, all in Phase 6:
  - App Attest, DeviceCheck and Play Integrity (`X-Attestation`, `attest_challenges`);
  - the privacy manifest and App Privacy label;
  - Play App Signing's SHA-1 on the Maps key;
  - store listings;
  - the EAS iOS team: the 5a TestFlight credentials sit under an individual team, not Gooder Software LLC, which needs an owner decision before Phase 6.
