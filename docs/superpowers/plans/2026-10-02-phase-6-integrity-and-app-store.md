# Phase 6: Integrity and the App Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every iPhone write provably come from the real app, then ship mymeetingapp 1.0 on the App Store against production. That covers:

- the server's half of App Attest (challenges, key registration, assertions on every write) and a DeviceCheck fallback, behind `REQUIRE_ATTESTATION`;
- the app's half: a key made once per install, attested on the first write, and an assertion on every write;
- the network audit holding `X-Attestation` to its shape;
- the privacy manifest, the App Privacy label, the age rating and the listing;
- clearer feed errors: a bot check (Cloudflare, Incapsula) told apart from a site's own restriction, in the sync and in discovery, and never worked around;
- "Search farther" when a place has no in-person meetings within 16 miles;
- a TestFlight round on staging with attestation switched on, then the App Review submission and the public release.

Android (Play Integrity, the Maps key, the Play listing) moves to a new Phase 6b (owner decision 2, 2026-10-02).

**Architecture:**

- **One header, two proofs.** `X-Attestation` is either `appattest.v1.<keyId>.<timestamp>.<assertion>` or `devicecheck.v1.<token>`. `packages/shared/src/attestation.ts` builds and reads it, and also builds the exact text an assertion signs (`assertionClientData`): the method, the path, the phone's clock and the raw body. The server, the app and the audit tool all use it.
- **Registration.** `POST /api/v1/attest/challenge` hands out a single-use challenge (kept 5 minutes in `attest_challenges`, linked to nothing). `POST /api/v1/attest/register` spends it, verifies Apple's attestation object (CBOR, Apple's App Attestation root, the nonce, `teamId.bundleId`, counter 0, the environment), and stores the key ID, public key and counter on the phone's `devices` row.
- **Every write.** `readWriteRequest(req, schema)` now reads the raw body, and `verifyAttestation` checks the assertion over that exact text: the signature, the app ID, a counter above the stored one, and a phone clock within a day. The counter is checked again under the device lock and kept on today's short-lived `device_days` row. A write never writes the `devices` row at all; a nightly fold brings it up to date (Task 5A). A phone without App Attest sends a DeviceCheck token, which the server checks with Apple using an ES256 provider token.
- **The phone.** A small local Expo module, `modules/app-integrity`, wraps `DCAppAttestService` and `DCDevice`. `src/device/app-integrity.ts` keeps the key ID in the Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). `sendWrite` sends one write at a time, attaches the proof, and replaces a key the server no longer knows, once. Whatever stops the phone from attesting (a simulator, Apple unreachable), the write goes without a proof and the server decides.
- **Rollout.** Staging and production run the new code with `REQUIRE_ATTESTATION=off` first. A TestFlight build proves registration on a real iPhone, then staging is switched on, then production is switched on before the App Review build is submitted.

**Tech Stack:**

- Next.js 16 route handlers, Drizzle and Postgres. New web dependencies: `cborg` 6.1.3 (CBOR, no dependencies) and `asn1js` 3.0.10 (one certificate extension). X.509 chain checks, ECDSA and ES256 use `node:crypto`.
- Expo SDK 57 (`expo` 57.0.26), a local Expo module in Swift (DeviceCheck, CryptoKit), `expo-secure-store` ~57.0.4. `@expo/plist` 0.8.1 as a mobile dev dependency for the privacy-manifest test.
- EAS CLI 24.8.0 (`build`, `submit`, `metadata:push`), App Store Connect, the Vercel CLI.
- vitest (web, shared, audit tool), Jest 29 with `jest-expo` 57 (mobile).

**Spec:** `SPEC.md` (v2): §2, §6 (App Attest, DeviceCheck; Play Integrity moves to 6b), §7 (headers, `attest/*` endpoints, `attestation_failed`), §11, §12 (secrets), §13, §14, §16. Read it alongside:

- the roadmap, `docs/superpowers/plans/2026-09-26-roadmap.md` (Phase 6, and the Phase 6b section Task 1 adds);
- the standards, `docs/standards.md` (binding);
- `docs/deploy.md` (staging, secrets) and `docs/mobile.md` (TestFlight, the proxy audit);
- the 5b plan, `docs/superpowers/plans/2026-10-01-phase-5b-mobile-tagging.md` (the write client this builds on).

**Depends on:** Phases 1–5b merged (`main` at `ea134dd`). This plan's branch is `phase-6-integrity`, made from it.

## Owner decisions recorded (2026-10-02)

1. **Publisher: Gooder Software LLC, through a membership conversion.** The owner's existing Apple Developer membership (team `PVCZBLDJ73`, App Store Connect app `6817873804`, bundle ID `com.goodersoftware.mymeetingapp`) is being converted from individual to organization. There is **no app transfer and no new app record**. The plan covers only the follow-ups (Task 1), and the release doesn't wait on the conversion (Owner decision needed 1).
   - Why no transfer: Apple only transfers an app that "must have at least one version that was released to the App Store". Why no new record: after a build has been uploaded, a removed app's bundle ID "can't be reused". Both are moot now; they are recorded so nobody tries them later.
2. **iOS first.** Play Integrity, the Android Maps key, the Play listing and the deferred Android device checks move to "Phase 6b: Android" in the roadmap (Task 1). Nothing Android is built here. Until 6b, a required check refuses Android writes, and no Android build is published.
3. **Phase 6 ends with a public App Store release against production.** TestFlight testers stay on staging until then (Task 15 keeps the production build out of their group).

## Findings (with evidence)

1. **The seam.** `verifyAttestation` in `apps/web/src/server/devices/attestation.ts` is synchronous, takes no body, and refuses everything while `REQUIRE_ATTESTATION` is on. `readWriteRequest` runs it before the route reads the body, so an assertion over the body can't be checked there yet (Task 6).
2. **The `devices` row and transaction IDs.** `writeAsDevice` records the device in its own transaction, committed just before the write. So the row's `xmin` sits one id from the write's tag rows (on a later write that day, it's the `xmax` its lock stamps). A physical copy of the database therefore links a device to the meeting of its latest write (review, 2026-10-02; `.superpowers/sdd/2026-10-02-phase-6-integrity-and-app-store/xmin-design-note.md`). Owner decision (2026-10-02, Option A): the write path stops writing `devices`, and a nightly fold carries the day and the App Attest counter in from a two-day `device_days` row (Task 5A). Task 6 keeps its counter there.
3. **`@expo/app-integrity` exists but isn't usable here.** It is Expo's App Attest and Play Integrity module, published with an `sdk-57` tag (57.0.2). But:
   - its docs mark it alpha ("will frequently experience breaking changes");
   - it is **not** in `expo` 57.0.26's `bundledNativeModules.json` (checked in `node_modules` and on the `sdk-57` branch);
   - it has no DeviceCheck call.

   Per the brief, the plan extends the local-module pattern instead (`modules/app-integrity`, Task 8). Its Swift mirrors Expo's own: `SHA256(challenge)` as the client data hash.

4. **Apple's attestation sample.** Apple's "Attestation object validation guide" publishes a real attestation object (team `1234567890`, bundle `com.example.myapp`). Prototyped against the plan's verifier, it verifies at 2026-04-21 and fails today, because its leaf certificate ran 2026-04-20 to 2026-04-23. Two details the prototype surfaced:
   - the sample's device was given the raw challenge as its client data hash, so the verifier takes `clientDataHash` as input, and the route passes `SHA256(challenge)`;
   - its authenticator data ends with an extensions map (`apple_bundle_version_01`, `apple_validation_category_01`) though the ED flag is clear, and the COSE key uses integer map keys, so CBOR must decode with `useMaps`.
5. **Environments.** Apple's validation steps name the development AAGUID `appattestdevelop`; its sandbox guide names `appattestsandbox`. Development accepts both. "After distributing your app through TestFlight, the App Store … your app ignores the entitlement you set and uses the production environment." So staging and production verify against production, and only local web (dev builds on a device) uses development.
6. **Keys don't survive reinstalling.** Apple: keys "don't survive app reinstallation, device migration, or restoration of a device from a backup". The Keychain keeps the key ID through a reinstall, so `generateAssertion` then fails with `invalidKey`, and the app must make and register a new key (Review Focus 2).
7. **Privacy manifests.** Expo: Apple "does not correctly parse all the PrivacyInfo files included by static CocoaPods dependencies", so the app declares them. A scan of the app's iOS dependencies (and Expo's own native modules) on 2026-10-02 found:
   - FileTimestamp `C617.1` (React Native, expo-application, react-native-maps), and `0A2A.1`, `3B52.1` (expo-file-system, which `expo` itself depends on);
   - UserDefaults `CA92.1` (React Native, expo-constants, expo-system-ui);
   - SystemBootTime `35F9.1` (React Native);
   - DiskSpace `E174.1`, `85F4.1` (expo-file-system).

   react-native-maps' Google Maps bundle is only built with Google Maps on iOS, which the app doesn't use. Its root manifest, which claims precise location, isn't bundled as a resource.

8. **Apple's "collect" vs spec §11.** Apple: "data sent to servers but immediately discarded after servicing the request does not constitute collection". The rounded search point is used for one query and never stored, so by Apple's definition it isn't collected. Spec §11 lists Coarse Location anyway (Owner decision needed 5).
9. **Screenshots.** One iPhone set: 6.9" (1320 × 2868, 1290 × 2796 or 1260 × 2736) or 6.5". JPEG or PNG, no alpha, 1 to 10 images. `supportsTablet: false`, so no iPad set.
10. **Age rating.** The 2025 questionnaire puts "Alcohol, Tobacco, or Drug Use or References: Infrequent" at 13+ and "Health or Wellness Topics" at 9+. Social Media questions are required from September 2026.
11. **App Review.**
    - Guideline 5.1.1(ix): apps in "highly regulated fields (such as … healthcare …) or that require sensitive user information should be submitted by a legal entity". This argues for releasing under the LLC.
    - Guideline 2.1(a): "placeholder text … should be scrubbed". The privacy policy and terms still say "Draft, pending legal review." (Owner decision needed 4).
12. **The website.** `store-badges.tsx` says "They become links in Phase 6". `landing-page.test.tsx` pins "coming soon". The JSON-LD already says `LifestyleApplication`.
13. **TestFlight internal groups** can distribute every new build automatically. A production-profile build uploaded to the same app would then reach testers. Task 15 turns that off first.
14. **The audit tool** flags any `X-Attestation` ("isn't switched on yet") and knows only the five 5b writes (`tools/network-audit/src/headers.ts`, `audit.ts`).

## Owner decisions (all settled 2026-10-02)

Each has a recommendation, and the plan follows it so work isn't blocked.

1. **Settled (owner, 2026-10-02): wait.** If the conversion isn't finished when App Review approves 1.0, the build is held in "Pending Developer Release" until it is.
   - **Recommendation: wait,** holding the approved build in "Pending Developer Release". Guideline 5.1.1(ix) asks for a legal entity in health-adjacent apps, the spec names Gooder Software LLC as publisher, and a recovery app would show the owner's own name as seller. Submit for review anyway, so review time runs alongside the conversion.
2. **The App Store name.** The record is "mymeetingapp (817abd)" because EAS found "mymeetingapp" taken. Spec §11 keeps "AA" out of the name.
   - **Owner chose "My Meeting App: Meeting Finder"** (2026-10-02; 30 characters, exactly Apple's limit). The home-screen name stays `mymeetingapp`.
3. **The subtitle.** Owner chose a fellowship-neutral subtitle (2026-10-02); exact wording to confirm, default "Recovery meetings near you".
   - The owner's own wording, "Find recovery meetings near you", is 31 characters, one over Apple's 30. "Recovery meetings near you" (26) is the closest fit and is what `store.config.json` carries (Task 11). It keeps the listing open to the other 12-step fellowships planned for later.
4. **Settled (owner, 2026-10-02): the privacy policy and terms are final as written.** The draft notices were removed in PR #19; an outside legal review is optional and doesn't block submission.
5. **Settled (owner, 2026-10-02): declare Coarse Location on the App Privacy label.** By Apple's definition it isn't collected (finding 8).
   - **Recommendation: declare it, as spec §11 says.** Over-disclosure is safe; under-disclosure isn't. The privacy policy already describes the rounded search point.

## Decisions this plan makes (confirm at review)

1. **The local module over `@expo/app-integrity`** (finding 3). Revisit once Expo bundles it in an SDK and marks it stable.
2. **What an assertion signs.** Spec §6 says "the SHA-256 of the request body plus timestamp". The plan also signs the method and path:

   ```
   mymeetingapp write v1
   <METHOD>
   <path>
   <timestamp ms>
   <body>
   ```

   so an assertion can't be replayed against another endpoint. There is no per-write challenge: the strictly rising counter already stops replays, and it saves a round trip.

3. **Clock window: 24 hours either way.** The counter does the anti-replay work. The timestamp only stops an assertion being held for days, and a tight window would refuse phones with a wrong clock.
4. **The phone attests when it can; the server decides.** A failed registration, Apple being unreachable or a simulator sends the write without a proof. With the switch off it succeeds; with it on, the server answers `attestation_failed` in its own words.
5. **Writes go one at a time** on the phone, so assertion counters reach the server in order.
6. **One retry.** When the server refuses an App Attest proof, the app forgets its key, registers a new one and sends the write once more. Nothing was written the first time, because the check runs before any write.
7. **Registration and the challenge endpoint skip the version check,** like deletions, so an app of any version can still delete its data once checks are required. The challenge endpoint is limited to 10 a day per device (`rate_limits` bucket `attestation`). A Vercel Firewall rule (owner) limits each IP. Superseded 2026-10-04: no Firewall rule (paid feature, O5); a site-wide count of 1,000 challenges a UTC hour (bucket `attestation_site`) is the backstop instead.
8. **DeviceCheck is only a fallback.**
   - A phone that has registered an App Attest key can't switch to DeviceCheck.
   - Staging holds no DeviceCheck key, so it refuses DeviceCheck. Only production holds the `.p8`, as a Sensitive variable.
   - Spec §6's "DeviceCheck bits for flagging abusive devices across reinstalls" is deferred to the roadmap. The Keychain ID already survives a reinstall, so the bits would only matter after a full device erase.
9. **Not stored or enforced yet:** Apple's attestation receipt (for the fraud metric), and the values of `apple_validation_category_01` and `apple_bundle_version_01`. Apple doesn't document their values for TestFlight or App Store builds. The verifier checks the extensions map is well-formed. The roadmap carries both.
10. **The verifier takes the moment it checks against (`at`).** Certificate validity is checked against it; the route passes `new Date()`. It's an input of a pure function, so Apple's dated sample can be checked. The standards table gets a row for it.
11. **Store facts:**
    - availability: the United States only (the meeting data is US-only);
    - iPhone only: "Make this app available on Mac" and Apple Vision Pro switched off;
    - price: free;
    - category: Lifestyle, then Health & Fitness (matches the site's JSON-LD);
    - age rating: 13+ (Task 10's answers);
    - manual release;
    - version 1.0.0.
12. **The listing lives in `apps/mobile/store.config.json`** (EAS Metadata), with a test for Apple's limits. App Privacy answers, the age rating and the App Review contact are entered by hand from `docs/app-store.md`. App Privacy isn't in the API, and the review contact is the owner's phone number, which stays out of git.
13. **Staging switches the check on** once the attesting TestFlight build is out. A simulator can't attest, so simulator work that writes moves to local web (`REQUIRE_ATTESTATION=off`). Reads still work against staging.

## Global Constraints

- Everything in `docs/standards.md`:
  - `pnpm check` passes on every commit. `pnpm knip:production` and `pnpm --filter web test:e2e` pass at the end of the phase.
  - Test-driven: a failing test first.
  - No dead code: each export, table, column, fake, env var and config entry lands with its first consumer.
  - One way per concern: update the standards table in the same change as any new way.
  - Mobile tests fake native modules only at their package boundary (`test/native/*`, mapped in `jest.config.js`).
- Spec §2: "Device IDs are stored only as a keyed hash … The raw ID is never stored or logged." The attestation key ID, public key and counter sit on the hashed `devices` row only. No request header, body, token or assertion is ever logged.
- Spec §2: "Third parties that receive data must each be listed in the privacy policy: … Apple and Google (maps, platform geocoder, app attestation)".
- Spec §6: "iOS App Attest (+ DeviceCheck bits for flagging abusive devices across reinstalls) … Server verification sits behind `REQUIRE_ATTESTATION` so development works without it."
- Spec §6: "`POST /api/v1/attest/challenge` issues a single-use challenge (stored 5 minutes); `POST /api/v1/attest/register` verifies the iOS attestation and stores the key ID, public key, and counter under `device_hash`."
- Spec §6: "Each write: iOS sends an App Attest assertion over the SHA-256 of the request body plus timestamp; the server checks the signature and that the counter increased."
- Spec §7: "Mobile headers on write requests: `X-Device-Id`, `X-Platform` (`ios` | `android`), `X-App-Version`, `X-Attestation`." Reads carry none of them. Errors return `{ error: { code, message } }`; this phase's refusal is `attestation_failed` (401).
- Spec §7, `delete-mine`: deletes "rate-limit rows, audit rows and attestation data for this device".
- Spec §11:
  - "Privacy policy URL (both stores) and support URL (Apple), linked in the app's settings too."
  - App Privacy label: "Coarse Location (app functionality) · Device ID (app functionality, fraud prevention) · Other User Content (tags, suggestions) · All marked not linked to identity and not used for tracking."
  - "iOS location purpose strings (when-in-use, temporary full accuracy), iOS privacy manifest (required-reason APIs)".
  - "Age rating questionnaires (alcohol references apply)."
  - "App Store keywords: AA meetings, meeting finder, sobriety counter. 'AA' is an AAWS trademark: use it descriptively only, never in the app name or icon."
- Spec §12: secrets live only in Vercel environment variables. "Never commit them." The DeviceCheck `.p8` is never printed, logged or committed; it is passed to Vercel on stdin.
- Spec §13: "Stored on server" rows match the schema (`privacy-policy.test.tsx`). A new table means a new §13 row in the same change.
- Spec §4: "respect robots.txt, at most one request per second per host, a descriptive User-Agent with the contact email … Never hammer a site with retries." A bot check is recorded, never worked around (Task 12).
- Spec §16: legal review and "Confirm use of the 'AA' mark in store metadata is descriptive only" before launch.
- **TestFlight testers stay on staging until the public release.** Only the App Store build and the owner's one-person "Release check" group touch production before then (Task 15).
- Nothing in Tasks 2–13 reads or changes production data. Vercel, Neon, App Store Connect and EAS are touched only in steps marked **(Claude, with the owner's go-ahead)** or **(Owner)**. Claude never enters an Apple ID, password or 2FA code, and never downloads or prints the `.p8`.
- Each bash block runs as one command, from the repo root unless it says otherwise.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019qtuWT6wkew2g1c4qi6eKc
  ```

## Review Focus

1. **Two writes from one phone at once, or a write retried after a timeout.** The counters must reach the server in order; one that arrives out of order is refused. The person should never see "We couldn't confirm this request came from the app" just because they tapped Send and then Suggest quickly.
   - Pinned in Task 8 ("sends one write at a time, so its assertions arrive in order").
   - Pinned in Task 6 ("refuses an assertion whose counter isn't above the last one", "lets a retried write through when it signs again with the next counter").
2. **A reinstalled or restored iPhone.** The Keychain still holds the old key ID, but the key is gone. The app must notice (`invalidKey`), make and register a new key, and send the write, with no error shown. The server must let the new key replace the old one on the same device hash.
   - Pinned in Task 8 ("registers a new key when the saved one no longer works, as after a reinstall").
   - Pinned in Task 5 ("a new registration replaces the phone's old key and starts its counter again").
3. **After "Delete all my tags".** The server deletes the phone's key with everything else. The phone's next tag must re-register silently, not fail. The same holds for a blocked phone, whose row stays.
   - Pinned in Task 3 (delete-mine's "keeps only a blocked device's hash and block", extended to check that the key is cleared).
   - Pinned in Task 8 ("registers again after Delete all my tags, whose server deleted the key").
4. **A phone whose clock is wrong by hours** (manual time, a dead battery). It must still write within a day's drift, and be refused beyond it.
   - Pinned in Task 6 ("accepts a phone clock 23 hours off and refuses one 25 hours off").
5. **Apple's services unavailable.** If `attestKey` can't reach Apple, the write goes without a proof (accepted while the switch is off, refused in plain words while it's on), and no half-made key is saved. If Apple's DeviceCheck server fails, the request is a `server_error` ("Something went wrong on our end"), not `attestation_failed` ("update the app"), and the log holds only the status, never the token.
   - Pinned in Task 8 ("sends the write without a proof when Apple can't attest right now, and saves no key").
   - Pinned in Task 7 ("answers server_error and logs only the status when Apple's DeviceCheck fails").

6. **A feed behind a bot check** (Task 12). It must read as a bot check on /metrics, never as the intergroup's restriction, and must never be asked again any other way: one request, our User-Agent, no retry. Pinned in Task 12 ("asks a bot-checked feed once, as itself, and never again in that run", and discovery's "records a site behind a … bot check and stops probing it").
7. **"Search farther" offline, or empty again** (Task 13). Offline, the one search kept stands in, said so, with no second offer. Empty at 60 miles, the online meetings follow as before. Pinned in Task 13 ("offline, shows the last search in its place…", "falls back to the online meetings when 60 miles finds nothing either").

8. **Someone holding a physical copy of the database** (a Neon branch or restore, a disk image). Transaction ids must not link a device to the meeting of its latest write: no `devices` row may sit within one id of a tag row, whether through `xmin` or through the `xmax` a lock stamps.
   - Pinned in Task 5A ("leaves the device's record untouched: neither its xmin nor its xmax moves", "puts no device record within one transaction id of a fresh tag row (spec §2)").
   - Pinned in Task 6 ("keeps the counter on today's device_days row and never writes the device's record").

---

## Owner tasks, in order of lead time

Task 1 holds the steps; this is the order to start them in. None blocks Tasks 2–13.

| #   | Task                                                                                                                                                                                                                                                    | Lead time                               | Needed by                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| O1  | Finish the membership conversion (in progress), then the follow-ups: re-accept agreements, confirm team ID and seller name, confirm the EAS credentials and the App Store Connect API key `ZG2Z6A5JY3` still work                                       | Apple's verification: days to weeks     | Release (Owner decision needed 1); not the build |
| O2  | Optional: an outside legal review (the brief is ready); not required, per the owner's decision of 2026-10-02                                                                                                                                            | Weeks, if done                          | Nothing                                          |
| O3  | Choose and claim the App Store name, and rename the record from "mymeetingapp (817abd)"                                                                                                                                                                 | Minutes, but names can be taken any day | Task 11                                          |
| O4  | Create the DeviceCheck key (`.p8`) on team `PVCZBLDJ73` and keep it in the password manager                                                                                                                                                             | Minutes; download once only             | Task 15 (production)                             |
| O5  | Vercel Firewall rules: `/api/v1/attest/` per IP (new) and `/metrics` (pending since Phase 4). **Not done, by owner decision 2026-10-04 (paid feature); a site-wide backstop covers it** (`docs/deploy.md`, "Rate limits without Vercel Firewall rules") | Minutes                                 | Task 15                                          |
| O6  | Record Neon's production restore window in `docs/deploy.md` (pending since Phase 4)                                                                                                                                                                     | Minutes                                 | Task 15 (the privacy policy states 30 days)      |
| O7  | App Store Connect forms by hand: App Privacy, age rating, review contact, screenshots, availability                                                                                                                                                     | An hour                                 | Task 15                                          |

## File structure

```
SPEC.md (§6, §12, §13), docs/standards.md, docs/deploy.md, docs/mobile.md, roadmap
docs/app-store.md                           new: App Privacy answers, age rating, review notes, release checklist (Task 10)
eslint.config.js                            @modules/app-integrity banned outside src/device
packages/shared/src/attestation.ts          new: the X-Attestation header, assertion client data, attest contracts
packages/shared/src/index.ts, brand.ts      (+ appStoreId in Task 16)
packages/shared/test/attestation.test.ts
apps/web/
  package.json                              + cborg, asn1js
  .env.example                              + APPLE_TEAM_ID, APPLE_BUNDLE_ID, APP_ATTEST_ENVIRONMENT
  drizzle/0016_attestation.sql, 0017_attestation-limit.sql   generated
  src/env.ts                                + APPLE_TEAM_ID, APPLE_BUNDLE_ID, APP_ATTEST_ENVIRONMENT, DEVICECHECK_*
  src/db/schema/attestation.ts              new: attest_challenges
  src/db/schema/tagging.ts, index.ts        devices + attest_key_id, attest_public_key, attest_counter; bucket
  src/server/retention.ts                   + challengeMinutes
  src/server/maintenance.ts                 + challengesPurged
  src/server/tags/delete-mine.ts            clears the key on a kept (blocked) row
  src/server/devices/rate-limit.ts          + attestation: 10
  src/server/devices/write-request.ts       identifyDevice; readWriteRequest(req, schema) and readDeletionRequest read the body; writeAsDevice never writes devices (5A)
  src/server/devices/device-days.ts         new (5A): recordDeviceDay, foldDeviceDays; assertFreshCounter (6)
  src/server/devices/block-device.ts        blocks a device with only device_days rows (5A)
  drizzle/0018_device-days.sql              generated (5A)
  src/server/devices/attestation.ts         verifyAttestation over the request
  src/server/attest/apple-root.ts           new: Apple App Attestation Root CA (pinned)
  src/server/attest/app-attest.ts           new: verifyAttestationObject, verifyAssertion (pure)
  src/server/attest/config.ts               new: appAttestConfig
  src/server/attest/challenges.ts           new: issueChallenge, spendChallenge
  src/server/attest/keys.ts                 new: saveAttestKey, registeredKey, highestCounter, hasAttestKey
  src/server/attest/register.ts             new: registerAppAttestKey
  src/server/attest/device-check.ts         new: validDeviceCheckToken
  src/lib/api/request.ts                    + parseJsonText
  src/app/api/v1/attest/challenge/route.ts, register/route.ts   new
  src/app/api/v1/tags/route.ts, tags/[meetingId]/route.ts, tags/delete-mine/route.ts, suggestions/route.ts
  src/content/privacy-inventory.ts          devices columns, attest_challenges, Apple's role
  src/components/store-badges.tsx, src/app/(site)/layout.tsx   (Task 16: the App Store link, Smart App Banner)
  test/apple-attestation-sample.ts          generated from Apple's guide
  test/attest-fixtures.ts                   a real P-256 test key, signed write headers
  test/app-attest.test.ts, attest-routes.test.ts, attested-writes.test.ts, device-check.test.ts
  test/write-request.test.ts, maintenance.test.ts, delete-mine-route.test.ts, privacy-policy.test.tsx, db.ts
tools/network-audit/src/audit.ts, headers.ts, test/audit.test.ts, headers.test.ts
packages/feed-kit/src/feed-problem.ts, test/feed-problem.test.ts, test/fixtures/*   the shared feed-answer classifier (Task 12)
packages/feed-kit/src/registry.ts            + feed_type bot_blocked
apps/web/src/server/feeds/fetch-feed.ts       last_error from the classifier
tools/feed-discovery/src/detect.ts, report.ts  bot_blocked, and its own coverage.md heading
.prettierignore                              + packages/feed-kit/test/fixtures/
apps/mobile/
  app.config.ts                             entitlement, privacyManifests, appleTeamId, version 1.0.0
  eas.json                                  submit profiles pinned (team, app record, metadata path)
  store.config.json                         new: the App Store listing (EAS Metadata)
  store/screenshots/*.png                   new: the 6.9" set (Task 15)
  package.json, jest.config.js              + @expo/plist (dev); fake mapping
  modules/app-integrity/                    new: expo-module.config.json, index.ts, ios/AppIntegrityModule.swift, ios/AppIntegrity.podspec
  src/device/app-integrity.ts               new: the key in the Keychain, the native calls
  src/api/client.ts                         sendWrite attests, one at a time, retries once
  src/api/writes.ts                         deleteMine forgets the key
  src/location/geo.ts, src/app/(tabs)/index.tsx   WIDER_SEARCH_RADIUS_KM and "Search farther" (Task 13)
  test/native/app-integrity.ts              new fake; test/native/expo-secure-store.ts + deleteItemAsync
  test/api-server.ts                        + replyOnce
  test/attestation.test.ts, privacy-manifest.test.ts, store-listing.test.ts (new); writes.test.ts, eas-profiles.test.ts, app-shell.test.tsx, setup.ts
```

Test files by task:

| Task | Test files                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | none (owner work and the roadmap)                                                                                                                            |
| 2    | `packages/shared/test/attestation.test.ts`                                                                                                                   |
| 3    | web `privacy-policy.test.tsx`, `maintenance.test.ts`, `delete-mine-route.test.ts`, `write-request.test.ts`, `attest-routes.test.ts` (constraints)            |
| 4    | web `app-attest.test.ts`                                                                                                                                     |
| 5    | web `attest-routes.test.ts`                                                                                                                                  |
| 5A   | web `device-days.test.ts`; `write-request`, `tags-route`, `tag-edit-routes`, `delete-mine-route`, `maintenance`, `privacy-policy` tests; `admin-fixtures.ts` |
| 6    | web `attested-writes.test.ts`, `write-request.test.ts`                                                                                                       |
| 7    | web `device-check.test.ts`                                                                                                                                   |
| 8    | mobile `attestation.test.ts`, `writes.test.ts`, `app-shell.test.tsx` (entitlement)                                                                           |
| 9    | audit `audit.test.ts`, `headers.test.ts`                                                                                                                     |
| 10   | mobile `privacy-manifest.test.ts`                                                                                                                            |
| 11   | mobile `eas-profiles.test.ts`, `store-listing.test.ts`, `app-shell.test.tsx`                                                                                 |
| 12   | feed-kit `feed-problem.test.ts`; web `fetch-feed.test.ts`, `run-sync.test.ts`; discovery `detect.test.ts`, `report.test.ts`                                  |
| 13   | mobile `nearby.test.tsx`, `map.test.tsx`                                                                                                                     |
| 14   | none (staging, TestFlight and the iPhone audit)                                                                                                              |
| 15   | none (production and App Review)                                                                                                                             |
| 16   | web `landing-page.test.tsx`, `seo.test.ts`, `site.e2e.ts`                                                                                                    |
| 17   | mobile `edit-tags.test.tsx`, `meeting-detail.test.tsx` (optional)                                                                                            |

## Order of operations

1. **Task 1 first:** the owner starts O1–O4 on day one. Claude adds Phase 6b to the roadmap and creates the branch.
2. **Tasks 2–13 on `phase-6-integrity`,** in order, with Task 5A between 5 and 6: Task 6's counter lives on 5A's `device_days` row. Tasks 7 (DeviceCheck), 9 (audit), 10 (privacy), 11 (listing) and 12 (feed errors) depend only on Task 2 and may move; Task 12 touches no app code. Task 13 (Search farther) needs Task 8's `replyOnce`, and lands before the TestFlight build so testers get it.
3. **Task 14:** the PR is merged, staging and production run the code with checks off, a TestFlight build attests on a real iPhone, the iPhone audit passes, and staging switches checks on.
4. **Task 15:** production switches checks on, the production build is made and checked, and 1.0 is submitted to App Review with manual release.
5. **Task 16:** after approval (and Owner decision needed 1), release, then the website links to the App Store.
6. **Task 17 (optional)** at any point after Task 8: three 5b minors.

---

### Task 1: Owner track, the roadmap, and the branch

Owner decision 1 makes the Apple account work the longest lead in the phase. It runs in parallel with everything until Task 14. Claude's part is the roadmap (Phase 6 rewritten, Phase 6b added) and the branch.

**Files:**

- Modify: `docs/superpowers/plans/2026-09-26-roadmap.md`, `docs/deploy.md` (new section "Phase 6: app checks and the App Store", started here and filled by later tasks)

- [ ] **Step 1 (Claude): branch.** `git fetch origin && git switch -c phase-6-integrity origin/main`.

- [ ] **Step 2 (Owner, O1): the conversion follow-ups.** Apple doesn't publish a list of what a conversion keeps. Third-party guides and Apple's own wording ("contact us" to convert, D-U-N-S required) say the team, its apps and its certificates carry over and the seller name changes to the company. So **check each one** once Apple says the conversion is done, and record the results in `docs/deploy.md` under "Phase 6":
  1. **Agreements.** developer.apple.com → Account → accept any new Program License Agreement. Then App Store Connect → Business → Agreements: accept the Free Apps agreement as Gooder Software LLC. No paid agreement, tax or banking is needed: the app is free with no purchases.
  2. **Team ID.** Account → Membership details: the team ID is still `PVCZBLDJ73`, the entity is "Gooder Software LLC", and the program is "Organization". If the team ID has changed, stop and tell Claude: `APPLE_TEAM_ID`, `app.config.ts` and `eas.json` (Tasks 5, 11 and 14) all pin it.
  3. **Seller name.** App Store Connect → Business → the legal entity shows "Gooder Software LLC". The seller line on the product page comes from it; Task 16 checks it on the live listing.
  4. **App record.** App Store Connect → Apps still lists app `6817873804` with bundle ID `com.goodersoftware.mymeetingapp`, and its TestFlight builds are still there.
  5. **EAS credentials.** `cd apps/mobile && pnpm dlx eas-cli@24.8.0 credentials -p ios`, then choose the `testflight` profile: the distribution certificate is valid, and the provisioning profile is for `com.goodersoftware.mymeetingapp` on team `PVCZBLDJ73`. If EAS shows the old team name, that is a cached label and harmless.
  6. **App Store Connect API key.** App Store Connect → Users and Access → Integrations → Team Keys: `ZG2Z6A5JY3` is Active. EAS submits with it, so the real test is the next `--auto-submit` (Task 14 Step 5), which must finish with no Apple sign-in.
  7. **Team members.** Organization teams can add people: none are needed. Leave the owner as Account Holder.

- [ ] **Step 3 (Owner, O2): start the legal review** (spec §16). Send the lawyer:
  - `/privacy` and `/terms` from https://mymeetingapp.vercel.app;
  - SPEC.md §2 and §13;
  - the questions in spec §16, and whether "AA" may appear, descriptively, in the keywords ("aa meetings", spec §11).

  Its answers decide Owner decision needed 4 and the keywords.

- [ ] **Step 4 (Owner, O3): the App Store name.** App Store Connect → the app → App Information → Name: replace "mymeetingapp (817abd)" with the chosen name (Owner decision needed 2), and Save. App Store Connect refuses a name in use. Then try the fallback, and tell Claude which one stuck: Task 11 writes it into `store.config.json`, which must match.

- [ ] **Step 5 (Owner, O4): the DeviceCheck key.** It can be made now; it belongs to team `PVCZBLDJ73`, which the conversion keeps.
  1. developer.apple.com → Certificates, Identifiers & Profiles → Keys → **+**.
  2. Name it "mymeetingapp DeviceCheck", tick **DeviceCheck** and nothing else, Continue, Register.
  3. **Download** `AuthKey_<KEYID>.p8`. Apple allows this once. Put the file in the password manager and note the 10-character Key ID beside it.
  4. Never email it, commit it or paste it into a chat. If it's ever lost or exposed, revoke it on the same page and make another; nothing else depends on it.

- [x] **Step 6 (Owner, O5): Vercel Firewall.** Not done, by owner decision 2026-10-04 (paid feature); a site-wide backstop covers it: 1,000 challenges a UTC hour across the site (`rate_limits` bucket `attestation_site`) beside the 10 a day per device, and the existing 200 failed `/metrics` sign-ins a UTC day. See "Rate limits without Vercel Firewall rules" in `docs/deploy.md`.

- [ ] **Step 7 (Owner, O6): Neon's restore window.** Neon console → the production project → Settings → the restore window. Record it under "Restore history" in `docs/deploy.md`. It must be 30 days or less: the privacy policy says so.

- [ ] **Step 8 (Claude): the roadmap.** In `docs/superpowers/plans/2026-09-26-roadmap.md`:
  - In the overview table, replace Phase 6's row with these two:

    ```markdown
    | 6. Integrity + App Store | App Attest, DeviceCheck fallback, server verifiers, privacy manifest, App Privacy label, age rating, App Store listing, the 1.0 release | 5 | mymeetingapp 1.0 live on the App Store against production, with attestation required |
    | 6b. Android | Play Integrity and its verifier, the Maps key, the Android device pass, Data safety form, Play listing, Play release | 6 | mymeetingapp on Google Play against production |
    ```

  - Replace the "### Phase 6: Integrity + stores" section with:

    ```markdown
    ### Phase 6: Integrity + App Store

    Spec §6 (App Attest, DeviceCheck), §11 (Apple), §13, §16. Detailed plan: `2026-10-02-phase-6-integrity-and-app-store.md`.

    - Owner decisions (2026-10-02): publish as Gooder Software LLC by converting the existing membership (team PVCZBLDJ73, app 6817873804); iOS first, Android in 6b; the phase ends with the public App Store release against production.
    - `attest_challenges`, `POST /api/v1/attest/challenge` and `/register`, App Attest verification, assertions on every write, DeviceCheck fallback, `REQUIRE_ATTESTATION` on in staging and production.
    - The local module `modules/app-integrity`, the app's attestation client, the audit's `X-Attestation` rules.
    - Privacy manifest, App Privacy label, age rating, listing, screenshots, App Review notes, release.
    - Clearer feed errors (a bot check apart from a site's own restriction, never worked around) and "Search farther" (owner, 2026-10-02).
    - Later (not scheduled): DeviceCheck bits to flag a blocked iPhone across a full erase; storing App Attest receipts for Apple's fraud metric; enforcing `apple_validation_category_01` and `apple_bundle_version_01` once their App Store values are known.

    ### Phase 6b: Android

    Spec §6 (Play Integrity), §11 (Google). Not started; written when Phase 6 has shipped.

    - Play Integrity standard requests from the app, with a request hash over the same client data as an App Attest assertion (`assertionClientData`), and the server verifier behind `REQUIRE_ATTESTATION` (until then a required check refuses Android).
    - Google Cloud project and Play Integrity credentials (a new secret), the Play Console organization account, and the app's Play Console record.
    - The Android device pass deferred from 5b: the Maps key (`GOOGLE_MAPS_ANDROID_API_KEY`, with Play App Signing's SHA-1), emulator smoke, the Android proxy audit, keyboard insets.
    - Android privacy: the Data safety form from §13, plus Google's guidance for the Maps SDK and Play Integrity; content rating; the Play listing and screenshots; internal testing against staging, then production.
    - The website's Google Play badge becomes a link.
    ```

  - In "Accounts and non-engineering track", change the Apple bullet to `- [x] Apple Developer Program: converting the existing membership to Gooder Software LLC (owner, 2026-10-02)`.

- [ ] **Step 9 (Claude): deploy.md skeleton and commit.** Add to `docs/deploy.md`, after "Staging (TestFlight backend)":

  ```markdown
  ## Phase 6: app checks and the App Store

  ### The Apple account

  Team `PVCZBLDJ73`, converted from individual to Gooder Software LLC (owner decision 1, 2026-10-02). App Store Connect app `6817873804`, bundle ID `com.goodersoftware.mymeetingapp`. EAS submits with the App Store Connect API key `ZG2Z6A5JY3`.

  Conversion checks (Task 1 Step 2): _not yet recorded_.
  ```

  Then run `pnpm check`, and:

  ```bash
  git add docs/superpowers/plans/2026-09-26-roadmap.md docs/deploy.md
  git commit -m "docs: Phase 6 is iOS and the App Store; Android moves to Phase 6b"
  ```

---

### Task 2: One shared contract for app checks

The phone builds `X-Attestation` and the text it signs, the server reads both, and the audit tool checks the header's shape (spec §7: "All input is validated with zod schemas shared with the mobile app"). One module in `packages/shared` holds all of it, so the three can't drift. Spec §6 gains the exact signed text (Decision 2).

**Files:**

- Create: `packages/shared/src/attestation.ts`, `packages/shared/test/attestation.test.ts`
- Modify: `packages/shared/src/index.ts`, `SPEC.md` §6

**Interfaces:**

- Produces (from `@mymeetingapp/shared`):
  - `type AttestationProof = { kind: "appAttest"; keyId: string; timestamp: number; assertion: string } | { kind: "deviceCheck"; token: string }`;
  - `appAttestHeader(keyId: string, timestamp: number, assertion: string): string`;
  - `deviceCheckHeader(token: string): string`;
  - `parseAttestation(value: string): AttestationProof | null`;
  - `assertionClientData(request: { method: string; path: string; timestamp: number; body: string }): string`;
  - `AttestChallengeResponse` (`{ challenge }`, 43 base64url characters), `AttestRegisterRequest` (`{ keyId, attestation, challenge }`), `AttestRegisterResponse` (`{ registered: true }`), each with its type.

- [ ] **Step 1: Failing test.** Create `packages/shared/test/attestation.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  appAttestHeader,
  assertionClientData,
  AttestChallengeResponse,
  AttestRegisterRequest,
  deviceCheckHeader,
  parseAttestation,
} from "../src/index";

// App Attest key ids are the base64 SHA-256 of the public key: 43 characters and one "=".
const KEY_ID = "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=";
const CHALLENGE = "q3Jw0F2nYc5yQ0d1Gk7mR8sT9uV0wX1yZ2aB3cD4eF5";

describe("the X-Attestation header", () => {
  it("carries an App Attest key id, the phone's clock and the assertion, and reads back the same", () => {
    const header = appAttestHeader(KEY_ID, 1791201600000, "omlzaWduYXR1cmU=");
    expect(header).toBe(`appattest.v1.${KEY_ID}.1791201600000.omlzaWduYXR1cmU=`);
    expect(parseAttestation(header)).toEqual({
      kind: "appAttest",
      keyId: KEY_ID,
      timestamp: 1791201600000,
      assertion: "omlzaWduYXR1cmU=",
    });
  });

  it("carries a DeviceCheck token on an iPhone without App Attest", () => {
    expect(parseAttestation(deviceCheckHeader("AgAAAAbcdef+/=="))).toEqual({
      kind: "deviceCheck",
      token: "AgAAAAbcdef+/==",
    });
  });

  it.each([
    ["no version", `appattest.${KEY_ID}.1791201600000.abc=`],
    ["a key id of the wrong length", "appattest.v1.abc=.1791201600000.abc="],
    ["a clock that isn't milliseconds", `appattest.v1.${KEY_ID}.1791201600.abc=`],
    ["a coordinate", `appattest.v1.${KEY_ID}.1791201600000.36.162749`],
    ["an unknown kind", "playintegrity.v1.abc="],
    ["nothing after the kind", "devicecheck.v1."],
  ])("reads nothing from a header with %s", (_why, value) => {
    expect(parseAttestation(value)).toBeNull();
  });
});

describe("what an assertion signs", () => {
  it("is the method, path, clock and exact body, one per line, after a version line", () => {
    expect(
      assertionClientData({
        method: "POST",
        path: "/api/v1/tags",
        timestamp: 1791201600000,
        body: '{"meetingId":"0f8fad5b-d9cb-469f-a165-70867728950e","tags":["quiet"]}',
      }),
    ).toBe(
      'mymeetingapp write v1\nPOST\n/api/v1/tags\n1791201600000\n{"meetingId":"0f8fad5b-d9cb-469f-a165-70867728950e","tags":["quiet"]}',
    );
  });

  it("ends with an empty line for a write with no body", () => {
    expect(
      assertionClientData({ method: "POST", path: "/api/v1/tags/delete-mine", timestamp: 1, body: "" }),
    ).toBe("mymeetingapp write v1\nPOST\n/api/v1/tags/delete-mine\n1\n");
  });
});

describe("the attest contracts", () => {
  it("accept a 32-byte base64url challenge only", () => {
    expect(AttestChallengeResponse.safeParse({ challenge: CHALLENGE }).success).toBe(true);
    expect(AttestChallengeResponse.safeParse({ challenge: `${CHALLENGE}=` }).success).toBe(false);
    expect(AttestChallengeResponse.safeParse({ challenge: "short" }).success).toBe(false);
  });

  it("accept a registration of a key id, a base64 attestation and the challenge", () => {
    const registration = { keyId: KEY_ID, attestation: "o2NmbXRvYXBwbGUtYXBwYXR0ZXN0", challenge: CHALLENGE };
    expect(AttestRegisterRequest.parse(registration)).toEqual(registration);
    expect(AttestRegisterRequest.safeParse({ ...registration, attestation: "not base64!" }).success).toBe(
      false,
    );
    expect(
      AttestRegisterRequest.safeParse({ ...registration, attestation: "A".repeat(16_388) }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Watch it fail.** `pnpm --filter @mymeetingapp/shared test attestation`. Expected: FAIL; the imports don't exist.

- [ ] **Step 3: The module.** Create `packages/shared/src/attestation.ts`:

```ts
import { z } from "zod";

// Spec §6: an iPhone proves a write came from the real app with an App Attest assertion, or, on an iPhone without App
// Attest, a DeviceCheck token. The phone builds X-Attestation and the server reads it here, so the two can't drift;
// the network audit holds the header to the same shape.
const BASE64 = "[A-Za-z0-9+/]+={0,2}";
// A key id is the base64 SHA-256 of the key: 43 characters and one "=".
const KEY_ID = "[A-Za-z0-9+/]{43}=";
const APP_ATTEST = new RegExp(`^appattest\\.v1\\.(${KEY_ID})\\.([0-9]{13})\\.(${BASE64})$`);
const DEVICE_CHECK = new RegExp(`^devicecheck\\.v1\\.(${BASE64})$`);

export type AttestationProof =
  | { kind: "appAttest"; keyId: string; timestamp: number; assertion: string }
  | { kind: "deviceCheck"; token: string };

export function appAttestHeader(keyId: string, timestamp: number, assertion: string): string {
  return `appattest.v1.${keyId}.${String(timestamp)}.${assertion}`;
}

export function deviceCheckHeader(token: string): string {
  return `devicecheck.v1.${token}`;
}

// null for anything that isn't exactly one of the two shapes.
export function parseAttestation(value: string): AttestationProof | null {
  const appAttest = APP_ATTEST.exec(value);
  if (appAttest !== null) {
    const [, keyId = "", timestamp = "", assertion = ""] = appAttest;
    return { kind: "appAttest", keyId, timestamp: Number(timestamp), assertion };
  }
  const deviceCheck = DEVICE_CHECK.exec(value);
  return deviceCheck === null ? null : { kind: "deviceCheck", token: deviceCheck[1] ?? "" };
}

// The text an App Attest assertion signs (its SHA-256 is the client data hash): the method and path, so it can't be
// replayed against another endpoint; the phone's clock, which the server holds to a day; and the exact body bytes.
export function assertionClientData(request: {
  method: string;
  path: string;
  timestamp: number;
  body: string;
}): string {
  return [
    "mymeetingapp write v1",
    request.method,
    request.path,
    String(request.timestamp),
    request.body,
  ].join("\n");
}

// 32 random bytes, base64url without padding.
const AttestChallenge = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const AttestChallengeResponse = z.object({ challenge: AttestChallenge });
export type AttestChallengeResponse = z.infer<typeof AttestChallengeResponse>;

// Apple's attestation object is about 6 KB; 16 KB matches the header limit in WriteHeaders.
export const AttestRegisterRequest = z.object({
  keyId: z.string().regex(new RegExp(`^${KEY_ID}$`)),
  attestation: z
    .string()
    .max(16_384)
    .regex(new RegExp(`^${BASE64}$`)),
  challenge: AttestChallenge,
});
export type AttestRegisterRequest = z.infer<typeof AttestRegisterRequest>;

export const AttestRegisterResponse = z.object({ registered: z.literal(true) });
export type AttestRegisterResponse = z.infer<typeof AttestRegisterResponse>;
```

Add `export * from "./attestation";` to `packages/shared/src/index.ts`, in alphabetical order (first).

- [ ] **Step 4: Run it.** `pnpm --filter @mymeetingapp/shared test attestation`. Expected: PASS.

- [ ] **Step 5: Spec §6.** In the "Each write" bullet, after "over the SHA-256 of the request body plus timestamp", add: "(exactly: the line `mymeetingapp write v1`, then the method, path, the phone's clock in milliseconds and the raw body, one per line; `assertionClientData` in `packages/shared`), sent as `X-Attestation: appattest.v1.<keyId>.<timestamp>.<assertion>`, or `devicecheck.v1.<token>` from an iPhone without App Attest".

- [ ] **Step 6: Commit.** Run `pnpm check`. knip passes because Step 1's test uses every export, and Tasks 5–9 add the production consumers before the phase ends. Then:

```bash
git add packages/shared SPEC.md
git commit -m "feat(shared): the X-Attestation header, the text an assertion signs, and the attest contracts"
```

---

### Task 3: Storage — `attest_challenges`, the key on `devices`, its purge and its deletion

Spec §6 stores challenges for 5 minutes, and stores the key ID, public key and counter under the device hash. Spec §13's `devices` row already lists the "attestation key". This task adds the columns and the table, purges expired challenges nightly, makes delete-mine clear the key (spec §7), and keeps the privacy policy in step (`privacy-policy.test.tsx` fails first).

**Files:**

- Create: `apps/web/src/db/schema/attestation.ts`, `apps/web/test/attest-routes.test.ts` (constraint tests; Task 5 adds the route tests), `apps/web/drizzle/0016_attestation.sql` (generated)
- Modify: `apps/web/src/db/schema/tagging.ts`, `apps/web/src/db/schema/index.ts`, `apps/web/src/server/retention.ts`, `apps/web/src/server/maintenance.ts`, `apps/web/src/server/tags/delete-mine.ts`, `apps/web/src/content/privacy-inventory.ts`, `apps/web/test/db.ts`, `apps/web/test/maintenance.test.ts`, `apps/web/test/delete-mine-route.test.ts`, `apps/web/test/write-request.test.ts`, `SPEC.md` §13

**Interfaces:**

- Produces:
  - `attestChallenges` table (`challenge` text PK, `expiresAt` timestamptz), from `@/db/schema`;
  - `devices.attestKeyId: string | null`, `devices.attestPublicKey: string | null` (SPKI DER, base64), `devices.attestCounter: number | null`, all set or all null (`devices_attest_check`), with each key on one device only (`devices_attest_key_idx`);
  - `RETENTION.challengeMinutes = 5`;
  - `MaintenanceSummary.challengesPurged: number`.

- [ ] **Step 1: Spec §13, then watch the policy test fail.** In `SPEC.md` §13's stored-data table, add after the `devices` row:

  ```markdown
  | `attest_challenges` | random single-use challenge, expiry time | nothing | 5 minutes; used ones deleted at once, expired ones nightly |
  ```

  Run `pnpm --filter web exec vitest run privacy-policy`. Expected: FAIL, "has one entry for each row of the stored-data table".

- [ ] **Step 2: The schema.** Create `apps/web/src/db/schema/attestation.ts`:

```ts
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Spec §6: single-use App Attest challenges, kept RETENTION.challengeMinutes. Linked to nothing: the phone that asked
// isn't recorded with its challenge.
export const attestChallenges = pgTable(
  "attest_challenges",
  {
    challenge: text("challenge").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("attest_challenges_expires_idx").on(table.expiresAt)],
);
```

Add `export * from "./attestation";` to `src/db/schema/index.ts`. In `src/db/schema/tagging.ts`, import `bigint` from `drizzle-orm/pg-core`, and give `devices` three columns after `blocked`:

```ts
    // Spec §6: the phone's App Attest key once registered: Apple's key id, the public key (SPKI DER, base64) and the
    // highest assertion counter seen, which every write must exceed. All three or none.
    attestKeyId: text("attest_key_id"),
    attestPublicKey: text("attest_public_key"),
    attestCounter: bigint("attest_counter", { mode: "number" }),
```

and two entries in its table callback:

```ts
    // Apple: a key belongs to one device. Postgres treats nulls as distinct, so phones without a key don't collide.
    uniqueIndex("devices_attest_key_idx").on(table.attestKeyId),
    check(
      "devices_attest_check",
      sql`(${table.attestKeyId} is null) = (${table.attestPublicKey} is null) and (${table.attestKeyId} is null) = (${table.attestCounter} is null)`,
    ),
```

Add `challengeMinutes: 5,` to `RETENTION` in `src/server/retention.ts`. Add `"attest_challenges"` to `APP_TABLES` in `test/db.ts`. Generate the migration:

```bash
pnpm --filter web db:generate --name attestation
```

Expected: `apps/web/drizzle/0016_attestation.sql` creates `attest_challenges` and its index, adds the three nullable columns, the unique index and the check. Read it; never hand-edit it.

- [ ] **Step 3: The privacy policy.** In `src/content/privacy-inventory.ts`:
  - **`devices` entry:**
    - `table.columns` gains `"attest_key_id"`, `"attest_public_key"`, `"attest_counter"`.
    - In `what`, replace "the first and last day the app sent us tags or a suggestion (dates only)" with "the first and last day the app sent us tags, a suggestion or its app check (dates only)".
    - Replace ", whether we've blocked it for spam and, once app checks are switched on, the app's attestation key." with ", whether we've blocked it for spam and, on iPhone, the app's App Attest key: Apple's ID for the key, its public key and how many times it has signed a request. The private key never leaves the iPhone's Secure Enclave."
    - In `kept`, replace "we keep its hash, platform, dates and blocked flag" with "we keep its hash, platform, dates and blocked flag, but not its App Attest key,".
  - **A new entry, after `devices`:**

```ts
  {
    specRow: "attest_challenges",
    specCells: {
      contents: "random single-use challenge, expiry time",
      linkedTo: "nothing",
      retention: "5 minutes; used ones deleted at once, expired ones nightly",
    },
    table: { name: "attest_challenges", columns: ["challenge", "expires_at"] },
    title: "App check codes",
    what: "Before an iPhone proves it's running the real app, our server gives it a random one-time code that the proof must include, and keeps the code and when it stops working.",
    linkedTo: "Nothing. We don't record which phone asked for it.",
    kept: `${String(RETENTION.challengeMinutes)} minutes. A code is deleted as soon as it's used, and unused ones in the next nightly cleanup.`,
  },
```

Run `pnpm --filter web exec vitest run privacy-policy`. Expected: PASS.

- [ ] **Step 4: Failing tests for the constraints, the purge and delete-mine.** Create `apps/web/test/attest-routes.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { devices } from "@/db/schema";

import { resetDb } from "./db";
import { DEVICE_A_HASH, DEVICE_B_HASH } from "./tag-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

const KEY_ID = "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=";

describe("a phone's App Attest key", () => {
  it("is stored whole or not at all", async () => {
    await expect(
      db.insert(devices).values({ deviceHash: DEVICE_A_HASH, platform: "ios", attestKeyId: KEY_ID }),
    ).rejects.toMatchObject({ cause: { constraint: "devices_attest_check" } });
  });

  it("belongs to one phone only", async () => {
    const key = { attestKeyId: KEY_ID, attestPublicKey: "MFkw", attestCounter: 0 };
    await db.insert(devices).values({ deviceHash: DEVICE_A_HASH, platform: "ios", ...key });
    await expect(
      db.insert(devices).values({ deviceHash: DEVICE_B_HASH, platform: "ios", ...key }),
    ).rejects.toMatchObject({ cause: { constraint: "devices_attest_key_idx" } });
  });
});
```

In `test/maintenance.test.ts`, add inside `describe("runMaintenance")` (importing `attestChallenges` from `@/db/schema`):

```ts
it("deletes challenges past their 5 minutes and keeps live ones", async () => {
  await db.insert(attestChallenges).values([
    { challenge: "expired", expiresAt: new Date(Date.now() - 1000) },
    { challenge: "live", expiresAt: new Date(Date.now() + 60_000) },
  ]);
  expect((await runMaintenance()).challengesPurged).toBe(1);
  expect(await db.select({ challenge: attestChallenges.challenge }).from(attestChallenges)).toEqual([
    { challenge: "live" },
  ]);
});
```

and add `challengesPurged: 0,` to the expected body in "runs for Vercel Cron and reports counts only". In `test/delete-mine-route.test.ts`, extend "keeps only a blocked device's hash and block, so deleting can't lift it". Give the device a key before deleting (`await db.update(devices).set({ blocked: true, attestKeyId: KEY_ID, attestPublicKey: "MFkw", attestCounter: 7 });`, with `const KEY_ID = "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=";` at the top of the file), and replace its last expectation with:

```ts
// Spec §7: delete-mine deletes the attestation data too, even on the row a block keeps.
expect(
  (await db.select().from(devices)).map((row) => [
    row.deviceHash,
    row.blocked,
    row.attestKeyId,
    row.attestPublicKey,
    row.attestCounter,
  ]),
).toEqual([[DEVICE_A_HASH, true, null, null, null]]);
```

In `test/write-request.test.ts`'s first test, the expected `devices` row gains `attestKeyId: null, attestPublicKey: null, attestCounter: null`.

Run `pnpm --filter web exec vitest run attest-routes maintenance delete-mine-route write-request`. Expected: the constraint tests PASS (the migration holds them); the maintenance and delete-mine tests FAIL.

- [ ] **Step 5: The purge and the deletion.** In `src/server/maintenance.ts`, add `challengesPurged: z.number().int()` to `MaintenanceSummary`, import `attestChallenges`, and inside the purge transaction add:

```ts
// Spec §6: a challenge lives 5 minutes; spending one deletes it, so only unused ones are left here.
const challenges = await tx
  .delete(attestChallenges)
  .where(lt(attestChallenges.expiresAt, sql`now()`))
  .returning({ challenge: attestChallenges.challenge });
```

returning `challengesPurged: challenges.length` with the other counts. In `src/server/tags/delete-mine.ts`, after the `devices` delete:

```ts
// A blocked device's row stays, but not its App Attest key (spec §7: delete-mine deletes attestation data).
await tx
  .update(devices)
  .set({ attestKeyId: null, attestPublicKey: null, attestCounter: null })
  .where(eq(devices.deviceHash, device.deviceHash));
```

and add "and the App Attest key on a blocked device's kept row" to the function's comment.

Run `pnpm --filter web exec vitest run attest-routes maintenance delete-mine-route write-request privacy-policy`. Expected: PASS.

- [ ] **Step 6: Commit.** `pnpm check` (its migration drift check must find nothing new), then:

```bash
git add apps/web SPEC.md
git commit -m "feat(api): attest_challenges, the App Attest key on devices, its nightly purge and its deletion"
```

---

### Task 4: The App Attest verifier

Two pure functions do all of Apple's checks, with no database and no environment, so they can be tested against Apple's own sample attestation and real P-256 signatures. Apple's steps, in "Validating apps that connect to your server":

- **Attestation:** the `x5c` chain up to Apple's App Attestation root; nonce = SHA-256(authData ‖ clientDataHash), equal to the leaf's `1.2.840.113635.100.8.2` extension; the key ID equal to the SHA-256 of the leaf's public key; the RP ID equal to the SHA-256 of `teamId.bundleId`; counter 0; the AAGUID for the environment; the credential ID equal to the key ID.
- **Assertion:** nonce = SHA-256(authenticatorData ‖ SHA-256(clientData)); an ECDSA signature valid for the nonce; the RP ID; a counter above the stored one.

**Files:**

- Create: `apps/web/src/server/attest/apple-root.ts`, `apps/web/src/server/attest/app-attest.ts`, `apps/web/test/apple-attestation-sample.ts` (generated), `apps/web/test/attest-fixtures.ts`, `apps/web/test/app-attest.test.ts`
- Modify: `apps/web/package.json`, `docs/standards.md`

**Interfaces:**

- Produces (from `@/server/attest/app-attest`):
  - `type AppAttestEnvironment = "production" | "development"`;
  - `sha256(...parts: Uint8Array[]): Buffer`;
  - `verifyAttestationObject(input: { attestation: string; keyId: string; clientDataHash: Uint8Array; appId: string; environment: AppAttestEnvironment; at: Date }): { publicKey: string }`. It throws `ApiError("attestation_failed")` on any failure; `publicKey` is SPKI DER, base64.
  - `verifyAssertion(input: { assertion: string; clientData: string; publicKey: string; appId: string; storedCounter: number }): number`. It returns the new counter, or throws `ApiError("attestation_failed")`.
- Produces (test helpers, `apps/web/test/attest-fixtures.ts`):
  - `APP_ID = "PVCZBLDJ73.com.goodersoftware.mymeetingapp"`;
  - `testAttestKey(): TestAttestKey`, where `TestAttestKey = { keyId: string; publicKey: string; assert(counter: number, clientData: string, appId?: string): string }`.
  - Task 6 adds `attestedHeaders` here.

- [ ] **Step 1: Dependencies and Apple's sample.**

```bash
pnpm --filter web add cborg@6.1.3 asn1js@3.0.10
```

Then write Apple's published sample attestation object into a test fixture, straight from Apple's guide, and check it's byte-for-byte the one this plan was prototyped against:

```bash
curl -fsS https://developer.apple.com/tutorials/data/documentation/devicecheck/attestation-object-validation-guide.json \
  | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{const [m]=JSON.stringify(JSON.parse(s)).match(/o2NmbXRvYXBwbGUt[A-Za-z0-9+\/=]+/);process.stdout.write(`// Apple'"'"'s sample App Attest attestation object, from its "Attestation object validation guide" (developer.apple.com):\n// team 1234567890, bundle com.example.myapp, key zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=, made with the raw text\n// "example_server_challenge" as its client data hash. Its leaf certificate is valid 2026-04-20 18:13 to 2026-04-23 18:13 UTC.\nexport const APPLE_SAMPLE_ATTESTATION =\n  "${m}";\n`)})' \
  > apps/web/test/apple-attestation-sample.ts \
  && node -e 'const s=require("fs").readFileSync("apps/web/test/apple-attestation-sample.ts","utf8").match(/"(o2Nm[^"]+)"/)[1];console.log(s.length, require("crypto").createHash("sha256").update(s).digest("hex"))'
```

Expected: `7876 ef2b7c2279d46a2a32365ea80361740b7379aa67774777102a7251a517eaa938`. If Apple has changed the page, stop: the expected values in Step 3 belong to this sample.

- [ ] **Step 2: The pinned root.** Fetch Apple's App Attestation root and check its fingerprint before committing it:

```bash
curl -fsS https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem -o "$TMPDIR/attest-root.pem" \
  && openssl x509 -in "$TMPDIR/attest-root.pem" -noout -subject -enddate -fingerprint -sha256
```

Expected: `subject=CN = Apple App Attestation Root CA, O = Apple Inc., ST = California`, `notAfter=Mar 15 00:00:00 2045 GMT`, and `sha256 Fingerprint=1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32`. Create `apps/web/src/server/attest/apple-root.ts`:

```ts
// Apple App Attestation Root CA, from https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
// (valid to 2045-03-15). Pinned: an attestation must chain to exactly this certificate. app-attest.test.ts checks its
// SHA-256 fingerprint, so an edit here fails the tests.
export const APPLE_APP_ATTESTATION_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----`;
```

- [ ] **Step 3: Failing tests.** Create `apps/web/test/attest-fixtures.ts`:

```ts
import { createHash, generateKeyPairSync, sign } from "node:crypto";

import { encode } from "cborg";

// The app's App ID as App Attest names it: team id, a period, the bundle identifier.
export const APP_ID = "PVCZBLDJ73.com.goodersoftware.mymeetingapp";

const sha256 = (...parts: Uint8Array[]) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
};

export interface TestAttestKey {
  keyId: string;
  publicKey: string;
  // An assertion as a phone's Secure Enclave makes one: authenticator data (the App ID's hash, flags, the counter) and
  // an ECDSA signature over SHA-256(authenticatorData ‖ SHA-256(clientData)), CBOR-encoded, base64.
  assert(counter: number, clientData: string, appId?: string): string;
}

// A real P-256 key, standing in for one an iPhone made and Apple attested: tests store its public key as a
// registration would, then sign with it.
export function testAttestKey(): TestAttestKey {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ format: "der", type: "spki" });
  return {
    keyId: sha256(spki.subarray(-65)).toString("base64"),
    publicKey: spki.toString("base64"),
    assert(counter, clientData, appId = APP_ID) {
      const authenticatorData = Buffer.alloc(37);
      sha256(Buffer.from(appId)).copy(authenticatorData, 0);
      authenticatorData.writeUInt8(0x40, 32);
      authenticatorData.writeUInt32BE(counter, 33);
      const nonce = sha256(authenticatorData, sha256(Buffer.from(clientData)));
      const signature = sign("sha256", nonce, privateKey);
      return Buffer.from(encode({ signature, authenticatorData })).toString("base64");
    },
  };
}
```

Create `apps/web/test/app-attest.test.ts`:

```ts
import { X509Certificate } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/respond";
import { APPLE_APP_ATTESTATION_ROOT_CA } from "@/server/attest/apple-root";
import { sha256, verifyAssertion, verifyAttestationObject } from "@/server/attest/app-attest";

import { APPLE_SAMPLE_ATTESTATION } from "./apple-attestation-sample";
import { APP_ID, testAttestKey } from "./attest-fixtures";

// Apple's sample (apple-attestation-sample.ts), checked while its leaf certificate was valid.
const SAMPLE = {
  attestation: APPLE_SAMPLE_ATTESTATION,
  keyId: "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=",
  clientDataHash: Buffer.from("example_server_challenge"),
  appId: "1234567890.com.example.myapp",
  environment: "production" as const,
  at: new Date("2026-04-21T12:00:00Z"),
};

// What a check ends in: "accepted", the ApiError's code, or "another error" (a bug: Apple's bytes must never crash it).
function outcome(check: () => unknown): string {
  try {
    check();
    return "accepted";
  } catch (error) {
    return error instanceof ApiError ? error.code : "another error";
  }
}

describe("verifyAttestationObject", () => {
  it("accepts Apple's sample and returns the attested public key", () => {
    expect(verifyAttestationObject(SAMPLE)).toEqual({
      publicKey:
        "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEQzJUSs8yPbd0RDyq8zn1bn6VxyT6wsFCWfNl4kRWULK1+yhbz1Sby2BZRBLnaCokJ+6tqftS3+0LGrF+0J+pvQ==",
    });
  });

  it.each([
    ["after its leaf certificate expired", { at: new Date("2026-10-02T12:00:00Z") }],
    ["for another app", { appId: "1234567890.com.example.other" }],
    ["over another challenge", { clientDataHash: sha256(Buffer.from("example_server_challenge")) }],
    ["for another key id", { keyId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }],
    ["from the production environment when development is expected", { environment: "development" as const }],
    ["that isn't CBOR", { attestation: "bm90IGNib3I=" }],
    ["that isn't base64 at all", { attestation: "%%%" }],
  ])("refuses an attestation %s", (_why, change) => {
    expect(outcome(() => verifyAttestationObject({ ...SAMPLE, ...change }))).toBe("attestation_failed");
  });

  it("pins Apple's App Attestation root by its SHA-256 fingerprint", () => {
    expect(new X509Certificate(APPLE_APP_ATTESTATION_ROOT_CA).fingerprint256).toBe(
      "1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32",
    );
  });
});

describe("verifyAssertion", () => {
  const key = testAttestKey();
  const check = (assertion: string, change: { clientData?: string; storedCounter?: number } = {}) =>
    verifyAssertion({
      assertion,
      clientData: "signed text",
      publicKey: key.publicKey,
      appId: APP_ID,
      storedCounter: 0,
      ...change,
    });

  it("returns the counter of an assertion signed by the registered key over the same text", () => {
    expect(check(key.assert(1, "signed text"))).toBe(1);
  });

  it("refuses an assertion whose counter isn't above the last one", () => {
    expect(outcome(() => check(key.assert(5, "signed text"), { storedCounter: 5 }))).toBe(
      "attestation_failed",
    );
  });

  it("refuses an assertion over different text", () => {
    expect(outcome(() => check(key.assert(1, "signed text"), { clientData: "other text" }))).toBe(
      "attestation_failed",
    );
  });

  it("refuses an assertion made for another app", () => {
    expect(outcome(() => check(key.assert(1, "signed text", "1234567890.com.example.myapp")))).toBe(
      "attestation_failed",
    );
  });

  it("refuses an assertion signed by another key", () => {
    expect(outcome(() => check(testAttestKey().assert(1, "signed text")))).toBe("attestation_failed");
  });

  it("refuses an assertion that isn't CBOR", () => {
    expect(outcome(() => check("bm90IGNib3I="))).toBe("attestation_failed");
  });
});
```

Run `pnpm --filter web exec vitest run app-attest`. Expected: FAIL, `@/server/attest/app-attest` doesn't exist.

- [ ] **Step 4: The verifier.** Create `apps/web/src/server/attest/app-attest.ts`:

```ts
import { createHash, verify, X509Certificate } from "node:crypto";

import { Constructed, fromBER, ObjectIdentifier, OctetString } from "asn1js";
import { decode, decodeFirst } from "cborg";
import { z } from "zod";

import { ApiError } from "@/lib/api/respond";
import { APPLE_APP_ATTESTATION_ROOT_CA } from "@/server/attest/apple-root";

export type AppAttestEnvironment = "production" | "development";

const ROOT = new X509Certificate(APPLE_APP_ATTESTATION_ROOT_CA);
// The leaf certificate's extension holding the nonce Apple signed.
const NONCE_EXTENSION = "1.2.840.113635.100.8.2";
// Apple's validation steps name "appattestdevelop" for development; its sandbox guide names "appattestsandbox".
const AAGUIDS: Record<AppAttestEnvironment, readonly Buffer[]> = {
  production: [Buffer.concat([Buffer.from("appattest"), Buffer.alloc(7)])],
  development: [Buffer.from("appattestdevelop"), Buffer.from("appattestsandbox")],
};

const Bytes = z.instanceof(Uint8Array);
const AttestationObject = z.object({
  fmt: z.literal("apple-appattest"),
  attStmt: z.object({ x5c: z.tuple([Bytes, Bytes]), receipt: Bytes }),
  authData: Bytes,
});
const AssertionObject = z.object({ signature: Bytes, authenticatorData: Bytes });

function fail(): never {
  throw new ApiError("attestation_failed");
}

export function sha256(...parts: Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function children(node: unknown): unknown[] {
  return node instanceof Constructed ? node.valueBlock.value : [];
}

// The octet string inside the leaf's nonce extension: Certificate → tbsCertificate → [3] extensions → the one whose id
// is NONCE_EXTENSION → its value, a SEQUENCE holding [1] OCTET STRING.
function certificateNonce(certificate: X509Certificate): Buffer | null {
  const [tbs] = children(fromBER(certificate.raw).result);
  const wrapper = children(tbs).find(
    (node) => node instanceof Constructed && node.idBlock.tagClass === 3 && node.idBlock.tagNumber === 3,
  );
  for (const extension of children(children(wrapper)[0])) {
    const [id, ...rest] = children(extension);
    const value = rest.at(-1);
    if (!(id instanceof ObjectIdentifier) || id.valueBlock.toString() !== NONCE_EXTENSION) continue;
    if (!(value instanceof OctetString)) return null;
    const [nonce] = children(children(fromBER(value.valueBlock.valueHexView).result)[0]);
    return nonce instanceof OctetString ? Buffer.from(nonce.valueBlock.valueHexView) : null;
  }
  return null;
}

// Authenticator data with an attested credential: rpIdHash (32) ‖ flags (1) ‖ counter (4) ‖ aaguid (16) ‖ id length
// (2) ‖ credential id ‖ the COSE key (CBOR, integer keys) ‖ Apple's extensions map, which recent iOS appends even with
// the ED flag clear. The extensions are checked only for being well-formed (decision 9).
function attestedAuthData(bytes: Uint8Array) {
  const data = Buffer.from(bytes);
  if (data.length < 55) fail();
  const idLength = data.readUInt16BE(53);
  if (data.length < 55 + idLength) fail();
  const [, extensions] = decodeFirst(data.subarray(55 + idLength), { useMaps: true });
  if (extensions.length > 0) decode(extensions, { useMaps: true });
  return {
    rpIdHash: data.subarray(0, 32),
    counter: data.readUInt32BE(33),
    aaguid: data.subarray(37, 53),
    credentialId: data.subarray(55, 55 + idLength),
  };
}

function validAt(certificate: X509Certificate, at: Date): boolean {
  return new Date(certificate.validFrom) <= at && at <= new Date(certificate.validTo);
}

// Anything unexpected in Apple's bytes (bad CBOR, a certificate that won't parse) is a failed check, not a server error.
function refuseOnError<T>(check: () => T): T {
  try {
    return check();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    return fail();
  }
}

// Apple's attestation steps, in its order. `clientDataHash` is what the phone passed to attestKey (the route passes
// SHA-256 of the challenge, as modules/app-integrity makes it); `at` is the moment the certificates must be valid.
export function verifyAttestationObject(input: {
  attestation: string;
  keyId: string;
  clientDataHash: Uint8Array;
  appId: string;
  environment: AppAttestEnvironment;
  at: Date;
}): { publicKey: string } {
  return refuseOnError(() => {
    const object = AttestationObject.parse(decode(Buffer.from(input.attestation, "base64")));
    const [leafBytes, intermediateBytes] = object.attStmt.x5c;
    const leaf = new X509Certificate(leafBytes);
    const intermediate = new X509Certificate(intermediateBytes);
    if (!intermediate.verify(ROOT.publicKey) || !leaf.verify(intermediate.publicKey)) fail();
    if (![leaf, intermediate, ROOT].every((certificate) => validAt(certificate, input.at))) fail();
    const nonce = certificateNonce(leaf);
    if (nonce === null || !nonce.equals(sha256(object.authData, input.clientDataHash))) fail();
    const publicKey = leaf.publicKey.export({ format: "der", type: "spki" });
    const keyId = Buffer.from(input.keyId, "base64");
    // The key id is the SHA-256 of the raw (X9.62 uncompressed) point: the last 65 bytes of a P-256 SPKI.
    if (!sha256(publicKey.subarray(-65)).equals(keyId)) fail();
    const authData = attestedAuthData(object.authData);
    if (!authData.rpIdHash.equals(sha256(Buffer.from(input.appId)))) fail();
    if (authData.counter !== 0) fail();
    if (!AAGUIDS[input.environment].some((aaguid) => aaguid.equals(authData.aaguid))) fail();
    if (!authData.credentialId.equals(keyId)) fail();
    return { publicKey: publicKey.toString("base64") };
  });
}

// Apple's assertion steps. The caller stores the returned counter, so the next assertion must exceed it.
export function verifyAssertion(input: {
  assertion: string;
  clientData: string;
  publicKey: string;
  appId: string;
  storedCounter: number;
}): number {
  return refuseOnError(() => {
    const object = AssertionObject.parse(decode(Buffer.from(input.assertion, "base64")));
    const authData = Buffer.from(object.authenticatorData);
    if (authData.length < 37) fail();
    const nonce = sha256(authData, sha256(Buffer.from(input.clientData)));
    const key = { key: Buffer.from(input.publicKey, "base64"), format: "der", type: "spki" } as const;
    if (!verify("sha256", nonce, key, object.signature)) fail();
    if (!authData.subarray(0, 32).equals(sha256(Buffer.from(input.appId)))) fail();
    const counter = authData.readUInt32BE(33);
    if (counter <= input.storedCounter) fail();
    return counter;
  });
}
```

`Buffer.from("%%%", "base64")` gives an empty buffer, which CBOR refuses, so "isn't base64 at all" is refused through `refuseOnError`.

- [ ] **Step 5: Run.** `pnpm --filter web exec vitest run app-attest`. Expected: PASS (the prototype of this code passed the same cases against the same sample on 2026-10-02).

- [ ] **Step 6: Standards and commit.** Add two rows to `docs/standards.md`'s table, before "Tests in `apps/mobile`":

  ```markdown
  | App checks on the server (App Attest, DeviceCheck) | `verifyAttestation(request)` from `@/server/devices/attestation`, called only by `readWriteRequest` / `readDeletionRequest`. Apple's checks are the pure `verifyAttestationObject` / `verifyAssertion` from `@/server/attest/app-attest`, against the pinned `APPLE_APP_ATTESTATION_ROOT_CA`; CBOR is `cborg` (`useMaps` for COSE keys), the one certificate extension is read with `asn1js`, everything else is `node:crypto`. Any malformed Apple byte is `attestation_failed`, never a server error | review, `app-attest.test.ts` |
  | Time in a pure verifier | the moment to check against is an input (`at`), and the route passes `new Date()`; only pure functions take it (so Apple's dated sample can be checked) | review |
  ```

  Then `pnpm check`, and:

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/server/attest apps/web/test/apple-attestation-sample.ts apps/web/test/attest-fixtures.ts apps/web/test/app-attest.test.ts docs/standards.md
git commit -m "feat(api): verify App Attest attestations and assertions against Apple's root"
```

---

### Task 5: `POST /api/v1/attest/challenge` and `POST /api/v1/attest/register`

The two endpoints spec §7 lists. The challenge is single use, lasts 5 minutes and names no phone. Registration spends it, verifies the attestation with Task 4's verifier, and stores the key on the phone's row. Neither checks the app version (decision 7). The challenge endpoint is limited to 10 a day per phone.

A successful registration through the route can only be made by a real iPhone: Apple's sample was made for another app, over raw text rather than a hash, and its leaf has expired. So the route tests cover every refusal, `saveAttestKey` is tested directly, and Task 14 proves the success path on the owner's iPhone.

**Files:**

- Create: `apps/web/src/server/attest/config.ts`, `apps/web/src/server/attest/challenges.ts`, `apps/web/src/server/attest/keys.ts`, `apps/web/src/server/attest/register.ts`, `apps/web/src/app/api/v1/attest/challenge/route.ts`, `apps/web/src/app/api/v1/attest/register/route.ts`, `apps/web/drizzle/0017_attestation-limit.sql` (generated)
- Modify: `apps/web/src/env.ts`, `apps/web/.env.example`, `apps/web/src/db/schema/tagging.ts` (`RATE_LIMIT_BUCKETS`), `apps/web/src/server/devices/rate-limit.ts`, `apps/web/src/server/devices/write-request.ts`, `apps/web/src/content/privacy-inventory.ts`, `apps/web/test/attest-routes.test.ts`, `docs/standards.md`

**Interfaces:**

- Consumes: `verifyAttestationObject`, `sha256`, `AppAttestEnvironment` (Task 4); `attestChallenges`, `RETENTION.challengeMinutes`, the `devices` key columns (Task 3); `AttestChallengeResponse`, `AttestRegisterRequest`, `AttestRegisterResponse` (Task 2).
- Produces:
  - `identifyDevice(req: Request): WriteDevice` from `@/server/devices/write-request` (headers only: no version check, no attestation);
  - `appAttestConfig(): { teamId: string; appId: string; environment: AppAttestEnvironment } | null` from `@/server/attest/config`;
  - `issueChallenge(device: WriteDevice): Promise<AttestChallengeResponse>` and `spendChallenge(challenge: string): Promise<boolean>` from `@/server/attest/challenges`;
  - `saveAttestKey(device: WriteDevice, keyId: string, publicKey: string): Promise<void>` from `@/server/attest/keys`;
  - `registerAppAttestKey(device: WriteDevice, request: AttestRegisterRequest): Promise<void>` from `@/server/attest/register`;
  - the `rate_limits` bucket `"attestation"` (10 a day);
  - env names `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID`, `APP_ATTEST_ENVIRONMENT`.

- [ ] **Step 1: Failing tests.** Add to `apps/web/test/attest-routes.test.ts` (merging the imports with Task 3's: `format` from `node:util`, `sql` from `drizzle-orm`, `afterEach` and `vi` from vitest, `ERROR_MESSAGES` and `AttestChallengeResponse` from `@mymeetingapp/shared`, `attestChallenges` from `@/db/schema`):

```ts
import { POST as challengeRoute } from "@/app/api/v1/attest/challenge/route";
import { POST as registerRoute } from "@/app/api/v1/attest/register/route";
import { saveAttestKey } from "@/server/attest/keys";

import { APPLE_SAMPLE_ATTESTATION } from "./apple-attestation-sample";
import { DEVICE_B, deviceHeaders } from "./tag-fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const challenge = (headers: Record<string, string> = deviceHeaders()) =>
  challengeRoute(new Request("http://test/api/v1/attest/challenge", { method: "POST", headers }));

const register = (body: unknown, headers: Record<string, string> = deviceHeaders()) =>
  registerRoute(
    new Request("http://test/api/v1/attest/register", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

const refusal = { error: { code: "attestation_failed", message: ERROR_MESSAGES.attestation_failed } };

async function issued(): Promise<string> {
  return AttestChallengeResponse.parse(await (await challenge()).json()).challenge;
}

describe("POST /api/v1/attest/challenge", () => {
  it("issues a challenge for 5 minutes, stored with nothing about the phone", async () => {
    const res = await challenge();
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { challenge: given } = AttestChallengeResponse.parse(await res.json());
    const { rows } = await db.execute<{ challenge: string; minutes: number }>(
      sql`select challenge, round(extract(epoch from expires_at - now()) / 60)::int as minutes from attest_challenges`,
    );
    expect(rows).toEqual([{ challenge: given, minutes: 5 }]);
    expect(await db.select().from(devices)).toEqual([]);
  });

  it("needs the device headers", async () => {
    expect((await challenge({})).status).toBe(400);
  });

  it("works for an app below the minimum version, which may still need a key to delete its data", async () => {
    vi.stubEnv("MIN_VERSION_IOS", "9.0.0");
    expect((await challenge()).status).toBe(201);
  });

  it("issues 10 a day to one phone, then refuses with rate_limited", async () => {
    for (let n = 0; n < 10; n++) expect((await challenge()).status).toBe(201);
    const res = await challenge();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: { code: "rate_limited", message: ERROR_MESSAGES.rate_limited },
    });
    expect(await db.select().from(attestChallenges)).toHaveLength(10);
  });
});

describe("POST /api/v1/attest/register", () => {
  beforeEach(() => {
    vi.stubEnv("APPLE_TEAM_ID", "PVCZBLDJ73");
    vi.stubEnv("APPLE_BUNDLE_ID", "com.goodersoftware.mymeetingapp");
  });

  const registration = (given: string) => ({
    keyId: KEY_ID,
    attestation: APPLE_SAMPLE_ATTESTATION,
    challenge: given,
  });

  // Apple's sample is for another app, over another challenge, with an expired leaf: a real attestation that must fail.
  it("refuses an attestation that doesn't verify, and spends the challenge anyway", async () => {
    const res = await register(registration(await issued()));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(refusal);
    expect(await db.select().from(attestChallenges)).toEqual([]);
    expect(await db.select().from(devices)).toEqual([]);
  });

  it("refuses a challenge it never issued", async () => {
    expect(await (await register(registration("c".repeat(43)))).json()).toEqual(refusal);
  });

  it("refuses a challenge past its 5 minutes", async () => {
    await db
      .insert(attestChallenges)
      .values({ challenge: "e".repeat(43), expiresAt: new Date(Date.now() - 1000) });
    expect((await register(registration("e".repeat(43)))).status).toBe(401);
  });

  it("refuses an Android phone: App Attest is Apple's", async () => {
    const given = await issued();
    expect((await register(registration(given), deviceHeaders(DEVICE_B, "android"))).status).toBe(401);
  });

  it("refuses, and warns, while the App ID isn't configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("APPLE_TEAM_ID", undefined);
    expect((await register(registration(await issued()))).status).toBe(401);
    expect(warn.mock.calls.map((args) => format(...args)).join("\n")).toContain(
      "APPLE_TEAM_ID and APPLE_BUNDLE_ID must be set",
    );
  });

  it("refuses a body that isn't a registration", async () => {
    expect((await register({ keyId: KEY_ID })).status).toBe(400);
  });
});

describe("saveAttestKey", () => {
  const device = { platform: "ios" as const, deviceHash: DEVICE_A_HASH };
  const keyColumns = async () =>
    (await db.select().from(devices)).map((row) => [
      row.deviceHash,
      row.attestKeyId,
      row.attestPublicKey,
      row.attestCounter,
    ]);

  it("records a new phone with its key and a counter of 0", async () => {
    await saveAttestKey(device, KEY_ID, "MFkw");
    expect(await keyColumns()).toEqual([[DEVICE_A_HASH, KEY_ID, "MFkw", 0]]);
  });

  it("a new registration replaces the phone's old key and starts its counter again", async () => {
    await db.insert(devices).values({
      ...device,
      attestKeyId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      attestPublicKey: "old",
      attestCounter: 41,
      lastSeenDate: "2026-01-02",
    });
    await saveAttestKey(device, KEY_ID, "MFkw");
    expect(await keyColumns()).toEqual([[DEVICE_A_HASH, KEY_ID, "MFkw", 0]]);
    // Last-seen is the nightly fold's to move (Task 5A), never a request's.
    const [row] = await db.select().from(devices);
    expect(row?.lastSeenDate).toBe("2026-01-02");
  });

  it("refuses a key another phone already holds", async () => {
    await saveAttestKey({ platform: "ios", deviceHash: DEVICE_B_HASH }, KEY_ID, "MFkw");
    await expect(saveAttestKey(device, KEY_ID, "MFkw")).rejects.toMatchObject({ code: "attestation_failed" });
  });
});
```

Run `pnpm --filter web exec vitest run attest-routes`. Expected: FAIL; the routes and `saveAttestKey` don't exist.

- [ ] **Step 2: Config, env and the bucket.**
  - `src/env.ts`: add `| "APPLE_TEAM_ID" | "APPLE_BUNDLE_ID" | "APP_ATTEST_ENVIRONMENT"` to `EnvName`.
  - `.env.example`: add

    ```
    # App checks (Phase 6). Local web serves dev builds on a device, which attest in Apple's development environment.
    APPLE_TEAM_ID=PVCZBLDJ73
    APPLE_BUNDLE_ID=com.goodersoftware.mymeetingapp
    APP_ATTEST_ENVIRONMENT=development
    ```

  - `src/db/schema/tagging.ts`: `RATE_LIMIT_BUCKETS` becomes `["tag_submission", "suggestion", "metrics_login", "attestation"] as const`.
  - `src/server/devices/rate-limit.ts`: add `attestation: 10,` to `DAILY_LIMITS`, with the comment line "attestation counts App Attest challenges: a phone needs one per install, more only after Delete all my tags or a lost key."
  - Generate the migration: `pnpm --filter web db:generate --name attestation-limit`. Expected: `0017_attestation-limit.sql` drops and re-adds `rate_limits_bucket_check` with the four buckets.
  - `src/content/privacy-inventory.ts`, the `rate_limits` entry's `what`: "which daily limit it counts (new tags or suggestions)" becomes "which daily limit it counts (new tags, suggestions or app check codes)".

  Create `apps/web/src/server/attest/config.ts`:

```ts
import { readEnv } from "@/env";
import type { AppAttestEnvironment } from "@/server/attest/app-attest";

export interface AppAttestConfig {
  teamId: string;
  // What App Attest calls the App ID: the team id, a period, the bundle identifier.
  appId: string;
  environment: AppAttestEnvironment;
}

// TestFlight and App Store builds always attest in Apple's production environment, so staging and production use it;
// only local web, serving a dev build on a device, sets APP_ATTEST_ENVIRONMENT=development. null, with a warning (a
// misconfiguration), until both ids are set: every app check then fails closed.
export function appAttestConfig(): AppAttestConfig | null {
  const teamId = readEnv("APPLE_TEAM_ID");
  const bundleId = readEnv("APPLE_BUNDLE_ID");
  if (teamId === undefined || bundleId === undefined) {
    console.warn("[attestation] APPLE_TEAM_ID and APPLE_BUNDLE_ID must be set; refusing app checks");
    return null;
  }
  const environment = readEnv("APP_ATTEST_ENVIRONMENT") === "development" ? "development" : "production";
  return { teamId, appId: `${teamId}.${bundleId}`, environment };
}
```

- [ ] **Step 3: Challenges, keys and registration.** Create `apps/web/src/server/attest/challenges.ts`:

```ts
import { randomBytes } from "node:crypto";

import type { AttestChallengeResponse } from "@mymeetingapp/shared";
import { and, eq, gt, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { attestChallenges } from "@/db/schema";
import { consumeDailyLimit } from "@/server/devices/rate-limit";
import type { WriteDevice } from "@/server/devices/write-request";
import { RETENTION } from "@/server/retention";

// Spec §6: a single-use challenge, kept 5 minutes. The daily count is the only trace of who asked; the stored challenge
// names no phone.
export async function issueChallenge(device: WriteDevice): Promise<AttestChallengeResponse> {
  await consumeDailyLimit(device.deviceHash, "attestation", db);
  const challenge = randomBytes(32).toString("base64url");
  await db.insert(attestChallenges).values({
    challenge,
    expiresAt: sql`now() + make_interval(mins => ${RETENTION.challengeMinutes}::int)`,
  });
  return { challenge };
}

// Deleted as it's checked, so a challenge works once at most, whatever that attempt's outcome. An expired one isn't
// spent here; the nightly maintenance deletes it.
export async function spendChallenge(challenge: string): Promise<boolean> {
  const spent = await db
    .delete(attestChallenges)
    .where(and(eq(attestChallenges.challenge, challenge), gt(attestChallenges.expiresAt, sql`now()`)))
    .returning({ challenge: attestChallenges.challenge });
  return spent.length > 0;
}
```

Create `apps/web/src/server/attest/keys.ts`:

```ts
import { and, eq, ne } from "drizzle-orm";

import { db } from "@/db/client";
import { devices } from "@/db/schema";
import { ApiError } from "@/lib/api/respond";
import type { WriteDevice } from "@/server/devices/write-request";

// Spec §6: a registered key replaces any earlier one on the phone's row (a reinstall or restore makes a new key) and
// starts at counter 0. It never sets last-seen: the nightly fold does (Task 5A). Registration isn't a tag write and
// runs as one statement of its own, but the app registers just before its first write, so this row can sit a
// transaction id or two from that write's tag rows. The next nightly fold rewrites it (the phone wrote, so it has a
// device_days row), so that neighbour lasts at most a night, inside the 7-day audit window (spec §2).
export async function saveAttestKey(device: WriteDevice, keyId: string, publicKey: string): Promise<void> {
  // Apple: a key must belong to one device, so a replayed registration can't move it to another.
  const [elsewhere] = await db
    .select({ deviceHash: devices.deviceHash })
    .from(devices)
    .where(and(eq(devices.attestKeyId, keyId), ne(devices.deviceHash, device.deviceHash)));
  if (elsewhere !== undefined) throw new ApiError("attestation_failed");
  const key = { attestKeyId: keyId, attestPublicKey: publicKey, attestCounter: 0 };
  await db
    .insert(devices)
    .values({ ...device, ...key })
    .onConflictDoUpdate({ target: devices.deviceHash, set: key });
}
```

Create `apps/web/src/server/attest/register.ts`:

```ts
import type { AttestRegisterRequest } from "@mymeetingapp/shared";

import { ApiError } from "@/lib/api/respond";
import { sha256, verifyAttestationObject } from "@/server/attest/app-attest";
import { spendChallenge } from "@/server/attest/challenges";
import { appAttestConfig } from "@/server/attest/config";
import { saveAttestKey } from "@/server/attest/keys";
import type { WriteDevice } from "@/server/devices/write-request";

// Spec §6: verifies an iPhone's attestation and stores its key. The challenge is spent first, so it's gone whatever
// happens next. modules/app-integrity hands Apple SHA-256 of the challenge's text as the client data hash.
export async function registerAppAttestKey(
  device: WriteDevice,
  request: AttestRegisterRequest,
): Promise<void> {
  const spent = await spendChallenge(request.challenge);
  const config = appAttestConfig();
  if (!spent || device.platform !== "ios" || config === null) throw new ApiError("attestation_failed");
  const { publicKey } = verifyAttestationObject({
    attestation: request.attestation,
    keyId: request.keyId,
    clientDataHash: sha256(Buffer.from(request.challenge)),
    appId: config.appId,
    environment: config.environment,
    at: new Date(),
  });
  await saveAttestKey(device, request.keyId, publicKey);
}
```

In `src/server/devices/write-request.ts`, add:

```ts
// The phone a request names, hashed but not attested: for the app check's own endpoints, which run before the phone
// has a key. No version check (an app of any version may need a key to delete its data).
export function identifyDevice(req: Request): WriteDevice {
  const headers = readDeviceHeaders(req);
  return { platform: headers.platform, deviceHash: deviceHash(headers.platform, headers.deviceId) };
}
```

Create `apps/web/src/app/api/v1/attest/challenge/route.ts`:

```ts
import { AttestChallengeResponse } from "@mymeetingapp/shared";

import { jsonResponse, withErrors } from "@/lib/api/respond";
import { issueChallenge } from "@/server/attest/challenges";
import { identifyDevice } from "@/server/devices/write-request";

export const dynamic = "force-dynamic";

// Spec §7: a single-use App Attest challenge.
export const POST = withErrors(async (req: Request) =>
  jsonResponse(AttestChallengeResponse, await issueChallenge(identifyDevice(req)), "none", 201),
);
```

Create `apps/web/src/app/api/v1/attest/register/route.ts`:

```ts
import { AttestRegisterRequest, AttestRegisterResponse } from "@mymeetingapp/shared";

import { readJsonBody } from "@/lib/api/request";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { registerAppAttestKey } from "@/server/attest/register";
import { identifyDevice } from "@/server/devices/write-request";

export const dynamic = "force-dynamic";

// Spec §7: registers an iPhone's App Attest key.
export const POST = withErrors(async (req: Request) => {
  const device = identifyDevice(req);
  await registerAppAttestKey(device, await readJsonBody(req, AttestRegisterRequest));
  return jsonResponse(AttestRegisterResponse, { registered: true }, "none", 201);
});
```

- [ ] **Step 4: Run.** `pnpm --filter web exec vitest run attest-routes privacy-policy`. Expected: PASS.

- [ ] **Step 5: Standards and commit.** In `docs/standards.md`, extend the "Mobile write requests (device headers)" row: "The app check's own endpoints (`/attest/challenge`, `/attest/register`) use `identifyDevice(req)`: the device hashed, with no version check and no attestation." Then `pnpm check`, and:

```bash
git add apps/web docs/standards.md
git commit -m "feat(api): App Attest challenge and key registration endpoints"
```

---

### Task 5A: The write path stops writing `devices` (the nightly fold)

**Why.** A reviewer found that a device's row and its newest tag row end up one Postgres transaction id apart (xmin T±1). The details are in `.superpowers/sdd/2026-10-02-phase-6-integrity-and-app-store/xmin-design-note.md`.

- `writeAsDevice` commits a `devices` upsert just before the write. On a later write the same day, the upsert changes nothing but still locks the row, which stamps its `xmax`.
- `tag_submissions` keeps its `xmin` until the device writes that meeting again.
- So anyone holding a physical copy of the database can read, for each device hash, which meeting its latest write touched. That breaks spec §2: "Nothing in our database links a device to the meetings it tagged, apart from a 7-day abuse-review log." Task 6 as first written would have refreshed that link on every write.

**The fix (owner decision, 2026-10-02: Option A, the nightly fold, in Phase 6).**

- **The write path never writes `devices`.** Under the device lock, a write reads only `blocked`; a plain read gets no transaction id and stamps nothing.
- **The day is noted in a short-lived `device_days` row.** One row per device per UTC day, written inside the write's own transaction and kept 2 days, as `rate_limits` is. Task 6 adds the App Attest counter's high-water mark to the same row.
- **Nightly, one statement folds those rows into `devices`.** It sets last-seen, raises the counter, and adds new devices. One statement is one transaction, so every row it touches gets the same xmin and no tag row is near it.

**Why a new table and not a `rate_limits` bucket.** `rate_limits` rows exist only where a daily limit is spent: new tags and suggestions. That isn't enough here:

- edits (`PUT`) spend no limit but must still count as "seen";
- the counter is one per device, not per bucket;
- the fold needs the platform to create a new device's row, and `rate_limits` has no platform column.

A `seen` bucket with nullable extra columns would have mixed two meanings into one table. `device_days` has the same shape of retention (two UTC days), the same link (device only, no meeting) and the same deletion by delete-mine.

**What it leaves, by design (the note's analysis):**

- **`device_days` shares its xmin with the write's tag rows.** It is a device-keyed row deleted within 2 days, inside the 7-day window in which `tag_audit` already holds the same link openly, exactly like `rate_limits`.
- **A new device appears in `devices` only after the night's fold,** and `last_seen_date` lags up to a day. `/metrics`' active-device counts lag with it.
- **Blocking a device that wrote since the last fold** first makes its row from `device_days`, then blocks it (below).
- **A blocked device's excluded rows are grouped by design.** The exclusion writes them all in one transaction, so they share one xmin; with few blocked devices, that names them. No xmin fix can remove this. Spec §2 says so (Step 5).
- **The fold itself is one transaction id.** A tag write committed just before or after it sits one id away from every device folded that night. That links a meeting to the whole set of devices active in the last two days, not to one. It runs at 08:07 UTC, the quietest hour.
- **Out of scope here: a pending suggestion one id from a tag write.** It names its device openly for up to 30 days, so a neighbouring tag write links the two. The roadmap's Phase 6 "Later" line carries it (Step 6).

**Files:**

- Create: `apps/web/src/server/devices/device-days.ts`, `apps/web/test/device-days.test.ts`, `apps/web/drizzle/0018_device-days.sql` (generated)
- Modify:
  - `apps/web/src/db/schema/tagging.ts`, `apps/web/src/server/retention.ts`, `apps/web/src/server/maintenance.ts`
  - `apps/web/src/server/devices/write-request.ts`, `apps/web/src/server/devices/block-device.ts`, `apps/web/src/server/tags/delete-mine.ts`
  - `apps/web/src/content/privacy-inventory.ts`
  - `apps/web/test/db.ts`, `apps/web/test/write-request.test.ts`, `apps/web/test/tags-route.test.ts`, `apps/web/test/tag-edit-routes.test.ts`, `apps/web/test/delete-mine-route.test.ts`, `apps/web/test/maintenance.test.ts`, `apps/web/test/admin-fixtures.ts`
  - `SPEC.md` §2, §13; `docs/standards.md`; `docs/superpowers/plans/2026-09-26-roadmap.md`

**Interfaces:**

- Consumes: the `devices` key columns (Task 3); `saveAttestKey` (Task 5); `lockDevice`, `WriteDevice` (5b).
- Produces:
  - **Schema:** `deviceDays` table from `@/db/schema`, with columns `device_hash` text, `day` date, `platform`, `attest_key_id` text null and `attest_counter` bigint null. The primary key is `device_days_pkey (device_hash, day)`, and the key id and counter are null together (`device_days_attest_check`).
  - **`recordDeviceDay(device: WriteDevice, tx: Executor): Promise<void>`** from `@/server/devices/device-days`. It notes today for the device, inside the write's transaction. Task 6 extends it to keep the counter.
  - **`foldDeviceDays(): Promise<number>`** from `@/server/devices/device-days`. It returns how many devices it folded.
  - **Retention:** `RETENTION.deviceDayDays = 2`.
  - **Maintenance summary:** `MaintenanceSummary.devicesFolded`, `MaintenanceSummary.deviceDaysPurged`.
  - **`writeAsDevice`** keeps its signature but no longer writes `devices`.
  - **`blockDevice`** also blocks a device that has only `device_days` rows.
  - **Registration** (Task 5's `saveAttestKey`, amended for this task) writes the key onto the `devices` row and never sets `last_seen_date`.
- **Is registration linkable to a meeting?** It isn't a tag write, and it runs in its own statement. But the app registers just before its first write, so the registered row can sit one or two transaction ids from that write's tag rows. The next nightly fold rewrites every row with a `device_days` row, and the phone that registered has one, because it wrote. So that neighbour lasts at most a night, inside the 7-day audit window. A registration whose write then failed leaves no tag row to point at. The tests below pin the after-the-fold half.

- [ ] **Step 1: Failing tests.** Create `apps/web/test/device-days.test.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST as tagRoute } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { deviceDays, devices, tagSubmissions } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { saveAttestKey } from "@/server/attest/keys";
import { blockDevice } from "@/server/devices/block-device";
import { foldDeviceDays } from "@/server/devices/device-days";
import { runMaintenance } from "@/server/maintenance";

import { resetDb } from "./db";
import {
  DEVICE_A_HASH,
  DEVICE_B,
  DEVICE_B_HASH,
  deviceHeaders,
  elsewhere,
  seedMeetingStarted,
} from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

const KEY_ID = "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=";
const DAY_MS = 86_400_000;
const utcDay = (offset = 0) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

function tag(meetingId: string, headers = deviceHeaders()) {
  return tagRoute(
    new Request("http://test/api/v1/tags", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ meetingId, tags: ["quiet"] }),
    }),
  );
}

// Every devices row's xmin and xmax (the latter set by a lock or update), as text.
const stamps = async () =>
  (
    await db.execute<{ xmin: string; xmax: string }>(
      sql`select xmin::text, xmax::text from devices order by device_hash`,
    )
  ).rows;

describe("a write and the device's record", () => {
  it("leaves the device's record untouched: neither its xmin nor its xmax moves", async () => {
    await db.insert(devices).values({ deviceHash: DEVICE_A_HASH, platform: "ios", lastSeenDate: utcDay(-1) });
    const before = await stamps();
    expect((await tag(await seedMeetingStarted(1))).status).toBe(201);
    expect((await tag(await seedMeetingStarted(1, elsewhere(1)))).status).toBe(201);
    expect(await stamps()).toEqual(before);
  });

  it("puts no device record within one transaction id of a fresh tag row (spec §2)", async () => {
    await db.insert(devices).values([
      { deviceHash: DEVICE_A_HASH, platform: "ios" },
      { deviceHash: DEVICE_B_HASH, platform: "android" },
    ]);
    const meetingId = await seedMeetingStarted(1);
    await tag(meetingId);
    await tag(meetingId, deviceHeaders(DEVICE_B, "android"));
    await tag(await seedMeetingStarted(1, elsewhere(1)));
    const { rows } = await db.execute<{ linked: number }>(sql`
      select count(*)::int as linked from devices d join tag_submissions s
        on abs(s.xmin::text::bigint - d.xmin::text::bigint) <= 1
        or (d.xmax::text::bigint <> 0 and abs(s.xmin::text::bigint - d.xmax::text::bigint) <= 1)
    `);
    expect(rows).toEqual([{ linked: 0 }]);
  });

  it("notes the day in device_days only, and makes no record for a new phone until the night", async () => {
    expect((await tag(await seedMeetingStarted(1))).status).toBe(201);
    expect(await db.select().from(devices)).toEqual([]);
    expect(await db.select().from(deviceDays)).toEqual([
      { deviceHash: DEVICE_A_HASH, day: utcDay(), platform: "ios", attestKeyId: null, attestCounter: null },
    ]);
  });

  it("still refuses a blocked device at once", async () => {
    await db.insert(devices).values({ deviceHash: DEVICE_A_HASH, platform: "ios", blocked: true });
    const res = await tag(await seedMeetingStarted(1));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "device_blocked" } });
    expect(await db.select().from(tagSubmissions)).toEqual([]);
  });

  it("blocks a phone that wrote since the last night's fold, and refuses its next write", async () => {
    await tag(await seedMeetingStarted(1));
    expect(await blockDevice(DEVICE_A_HASH)).toEqual({ excludedTags: 1 });
    const [row] = await db.select().from(devices).where(eq(devices.deviceHash, DEVICE_A_HASH));
    expect(row).toMatchObject({
      platform: "ios",
      blocked: true,
      firstSeenDate: utcDay(),
      lastSeenDate: utcDay(),
    });
    expect((await tag(await seedMeetingStarted(1, elsewhere(1)))).status).toBe(403);
  });
});

describe("the nightly fold", () => {
  it("adds new phones, moves last-seen on and keeps the highest counter for the current key, in one transaction", async () => {
    await db.insert(devices).values({
      deviceHash: DEVICE_A_HASH,
      platform: "ios",
      firstSeenDate: "2026-01-01",
      lastSeenDate: "2026-01-02",
      attestKeyId: KEY_ID,
      attestPublicKey: "MFkw",
      attestCounter: 3,
    });
    await db.insert(deviceDays).values([
      { deviceHash: DEVICE_A_HASH, day: utcDay(-1), platform: "ios", attestKeyId: KEY_ID, attestCounter: 5 },
      { deviceHash: DEVICE_A_HASH, day: utcDay(), platform: "ios", attestKeyId: KEY_ID, attestCounter: 9 },
      { deviceHash: DEVICE_B_HASH, day: utcDay(), platform: "android" },
    ]);
    expect(await foldDeviceDays()).toBe(2);
    const folded = await db.select().from(devices).orderBy(devices.deviceHash);
    expect(
      folded.map((row) => [
        row.deviceHash,
        row.platform,
        row.firstSeenDate,
        row.lastSeenDate,
        row.attestCounter,
      ]),
    ).toEqual([
      [DEVICE_B_HASH, "android", utcDay(), utcDay(), null],
      [DEVICE_A_HASH, "ios", "2026-01-01", utcDay(), 9],
    ]);
    const { rows } = await db.execute<{ ids: number }>(
      sql`select count(distinct xmin::text)::int as ids from devices`,
    );
    expect(rows).toEqual([{ ids: 1 }]);
  });

  it("ignores a counter from a key the phone has since replaced", async () => {
    await saveAttestKey({ platform: "ios", deviceHash: DEVICE_A_HASH }, KEY_ID, "MFkw");
    await db.insert(deviceDays).values({
      deviceHash: DEVICE_A_HASH,
      day: utcDay(),
      platform: "ios",
      attestKeyId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      attestCounter: 40,
    });
    await foldDeviceDays();
    const [row] = await db.select().from(devices);
    expect(row?.attestCounter).toBe(0);
  });

  it("moves a just-registered phone's record away from its first write's tag row", async () => {
    await saveAttestKey({ platform: "ios", deviceHash: DEVICE_A_HASH }, KEY_ID, "MFkw");
    await tag(await seedMeetingStarted(1));
    await foldDeviceDays();
    const { rows } = await db.execute<{ linked: number }>(sql`
      select count(*)::int as linked from devices d join tag_submissions s
        on abs(s.xmin::text::bigint - d.xmin::text::bigint) <= 1
    `);
    expect(rows).toEqual([{ linked: 0 }]);
  });

  it("runs first in the nightly maintenance, which then deletes days older than yesterday", async () => {
    await db.insert(deviceDays).values([
      { deviceHash: DEVICE_A_HASH, day: utcDay(-2), platform: "ios" },
      { deviceHash: DEVICE_A_HASH, day: utcDay(-1), platform: "ios" },
    ]);
    expect(await runMaintenance()).toMatchObject({ devicesFolded: 1, deviceDaysPurged: 1 });
    expect((await db.select().from(deviceDays)).map((row) => row.day)).toEqual([utcDay(-1)]);
    expect((await db.select().from(devices)).map((row) => row.lastSeenDate)).toEqual([utcDay(-1)]);
  });
});
```

In `test/delete-mine-route.test.ts`, add to the first test's expectations `expect((await db.select().from(deviceDays)).map((row) => row.deviceHash)).toEqual([DEVICE_B_HASH]);` (spec §7: delete-mine deletes everything kept for the device), importing `deviceDays`.

Run `pnpm --filter web exec vitest run device-days`. Expected: FAIL; `deviceDays` and `foldDeviceDays` don't exist.

- [ ] **Step 2: The table.** In `src/db/schema/tagging.ts`, after `devices`:

```ts
// Spec §2 and §6: the day a device wrote, and (Task 6) the highest App Attest counter it signed that day. Written inside
// the write's own transaction, so a device's record in `devices` is never written by a tag write; the nightly fold
// (foldDeviceDays) carries these into `devices`. Kept two UTC days, like rate_limits, and inside the 7-day audit window.
export const deviceDays = pgTable(
  "device_days",
  {
    deviceHash: text("device_hash").notNull(),
    day: date("day").notNull(),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    attestKeyId: text("attest_key_id"),
    attestCounter: bigint("attest_counter", { mode: "number" }),
  },
  (table) => [
    primaryKey({ name: "device_days_pkey", columns: [table.deviceHash, table.day] }),
    check("device_days_platform_check", sql`${table.platform} in (${sqlStringList(PLATFORMS)})`),
    check("device_days_attest_check", sql`(${table.attestKeyId} is null) = (${table.attestCounter} is null)`),
  ],
);
```

Add `deviceDayDays: 2,` to `RETENTION`, and `"device_days"` to `APP_TABLES` in `test/db.ts`. Then `pnpm --filter web db:generate --name device-days`. Expected: `0018_device-days.sql` creates the table, its key and both checks.

- [ ] **Step 3: The write path, the fold, blocking and deletion.** Create `apps/web/src/server/devices/device-days.ts`:

```ts
import { sql } from "drizzle-orm";

import { db, type Executor } from "@/db/client";
import { deviceDays, devices } from "@/db/schema";
import { utcToday } from "@/db/sql";
import type { WriteDevice } from "@/server/devices/write-request";

// Spec §2: a write never writes the device's record in `devices`, which would sit one transaction id from the write's
// tag rows and link the device to that meeting for as long as both stand. It notes the day here instead, inside its own
// transaction: a device-keyed row gone within two days, inside the window in which tag_audit holds the same link
// openly. A day already noted is left alone: no new row version, no lock.
export async function recordDeviceDay(device: WriteDevice, tx: Executor): Promise<void> {
  await tx
    .insert(deviceDays)
    .values({ deviceHash: device.deviceHash, day: utcToday, platform: device.platform })
    .onConflictDoNothing();
}

// Nightly, first in the maintenance run: every device with a day noted gets its record. A new device is added (first
// and last seen from its days), a known one has its last-seen day moved on, and its App Attest counter raised to the
// highest its current key signed. One statement, so one transaction: every record it touches shares that one xmin, and
// none is rewritten by a tag write. Returns how many devices it folded.
export async function foldDeviceDays(): Promise<number> {
  const folded = await db.execute<{ device_hash: string }>(sql`
    insert into ${devices} (device_hash, platform, first_seen_date, last_seen_date)
    select device_hash, min(platform), min(day), max(day) from ${deviceDays} group by device_hash
    on conflict (device_hash) do update set
      last_seen_date = greatest(${devices.lastSeenDate}, excluded.last_seen_date),
      attest_counter = case when ${devices.attestKeyId} is null then null else greatest(
        ${devices.attestCounter},
        (select max(d.attest_counter) from ${deviceDays} d
          where d.device_hash = ${devices.deviceHash} and d.attest_key_id = ${devices.attestKeyId})
      ) end
    returning device_hash
  `);
  return folded.rows.length;
}
```

In `src/server/devices/write-request.ts`, replace `writeAsDevice` and its comment with:

```ts
// Runs a device's write in one transaction under the device lock: refuses a blocked device, notes today in
// device_days, then writes. It never writes the device's record in `devices` (spec §2: that row would sit one
// transaction id from the write's tag rows); reading `blocked` takes no transaction id and stamps nothing. The nightly
// fold (foldDeviceDays) brings last-seen up to date. The block is read under the lock, so a device blocked in between
// is still refused.
export async function writeAsDevice<T>(device: WriteDevice, write: (tx: Executor) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await lockDevice(device.deviceHash, tx);
    const [row] = await tx
      .select({ blocked: devices.blocked })
      .from(devices)
      .where(eq(devices.deviceHash, device.deviceHash));
    if (row?.blocked === true) throw new ApiError("device_blocked");
    await recordDeviceDay(device, tx);
    return write(tx);
  });
}
```

import `recordDeviceDay` from `@/server/devices/device-days` (that module imports only the `WriteDevice` type back, so the cycle is type-only), and drop the now-unused `lt` and `utcToday` imports.

In `src/server/devices/block-device.ts`, replace the first statement (the `update … returning` and its "No device has that hash" check) with a call to:

```ts
// The block, committed on its own. A device that has written since the last nightly fold has no record yet, so it's
// made from its days, already blocked. False when the hash has neither.
async function markBlocked(deviceHash: string): Promise<boolean> {
  const updated = await db
    .update(devices)
    .set({ blocked: true })
    .where(eq(devices.deviceHash, deviceHash))
    .returning({ deviceHash: devices.deviceHash });
  if (updated.length > 0) return true;
  const made = await db.execute<{ device_hash: string }>(sql`
    insert into ${devices} (device_hash, platform, first_seen_date, last_seen_date, blocked)
    select device_hash, min(platform), min(day), max(day), true from ${deviceDays}
      where device_hash = ${deviceHash} group by device_hash
    on conflict (device_hash) do update set blocked = true
    returning device_hash
  `);
  return made.rows.length > 0;
}
```

used as `if (!(await markBlocked(deviceHash))) throw new Error("No device has that hash");`, importing `sql` and `deviceDays`. Everything after it stays: the exclusion's transaction and the final rewrite that moves the row's xmin off the exclusion's. Update `blockDevice`'s comment to "The block commits on its own first (making the device's record from its days if the nightly fold hasn't yet)".

In `src/server/tags/delete-mine.ts`, inside the transaction after the `rateLimits` delete, add `await tx.delete(deviceDays).where(eq(deviceDays.deviceHash, device.deviceHash));`, and add "device_days" to the function's comment.

In `src/server/maintenance.ts`:

- add `devicesFolded: z.number().int()` and `deviceDaysPurged: z.number().int()` to `MaintenanceSummary`;
- make `const devicesFolded = await foldDeviceDays();` the first line of `runMaintenance`, before the purge transaction, so a purged day has always been folded first. If the fold throws, the run stops and nothing is purged.
- inside the purge transaction, add:

```ts
// Two days, as rate_limits: today's and yesterday's UTC rows stay, so the next fold still sees yesterday's.
const days = await tx
  .delete(deviceDays)
  .where(lt(deviceDays.day, sql`${utcToday} - ${RETENTION.deviceDayDays - 1}::int`))
  .returning({ deviceHash: deviceDays.deviceHash });
```

and return `devicesFolded` and `deviceDaysPurged: days.length` with the other counts. Update the comment: "Folds the days devices wrote into their records first (foldDeviceDays), then enforces each retention limit, then rebuilds every count."

- [ ] **Step 4: Existing tests that read a record right after a write.** No device has a record until the night's fold, so these get the night first. Add `await foldDeviceDays();` (imported from `@/server/devices/device-days`) after their writes:
  - `test/tags-route.test.ts`: in "refuses a device blocked after it was recorded but before its write took the device lock", after the first `post`. Delete "leaves no transaction id linking the device's record to its tag or audit rows (spec §2)"; `device-days.test.ts` now holds that, more strictly.
  - `test/tag-edit-routes.test.ts`: before each `await db.update(devices).set({ blocked: true });` (two places).
  - `test/delete-mine-route.test.ts`:
    - in the first test, before calling `deleteMine()` (its `devices` expectation stays `[DEVICE_B_HASH]`);
    - in "keeps only a blocked device's hash and block", before the `db.update(devices)`;
    - in the xmin test, before blocking.
  - `test/admin-fixtures.ts`: at the end of `seedSwing`, so every admin test and e2e test starts with the phones' records made.
  - `test/write-request.test.ts`:
    - "hashes the device id and records the device by date only" now expects `devices` to be `[]` and `device_days` to hold one row for `DEVICE_A_HASH` today. After `foldDeviceDays()`, it expects the old row: today's dates and null key columns.
    - Replace "moves last_seen_date forward and keeps first_seen_date" with the same check run through `foldDeviceDays()`.
    - Replace "leaves the device's record untouched on a later write the same UTC day" with "leaves an existing record's xmin and xmax untouched": insert the row, read `stamps`, write twice, and expect them unchanged.
    - "never stores the raw device id" also checks `device_days`: `select row_to_json(d)::text from device_days d`.
  - `test/maintenance.test.ts`: the cron body gains `devicesFolded: 0, deviceDaysPurged: 0`.

  Then run `pnpm --filter web test`. Expected: PASS. Any other test that blocks or reads a device's record right after its own writes gets the same `await foldDeviceDays();` before that line.

- [ ] **Step 5: Spec, policy, standards.**
  - **`SPEC.md` §2**, after "The server knows meetings, not people." bullet, add:

    "- **No transaction ties a device to a tag.** A tag write never writes the device's record: it reads only whether the device is blocked, and notes the day in a two-day `device_days` row, which a nightly job folds into `devices` (so last-seen lags up to a day). A blocked device's excluded rows are written together when it's blocked, so they're grouped by design; that names only the blocked device."

  - **`SPEC.md` §13:**
    - Change the `devices` row's contents to "device hash, platform, first/last seen date (folded in nightly), blocked flag, attestation key".
    - Add after it:

    ```markdown
    | `device_days` | device hash, UTC day, platform, App Attest key id and highest counter that day | device only | 2 days; folded into devices nightly |
    ```

  - **`src/content/privacy-inventory.ts`:**
    - Set the `devices` entry's `specCells.contents` to match.
    - In its `what`, change "the first and last day the app sent us tags, a suggestion or its app check (dates only)" to "the first and last day the app sent us tags, a suggestion or its app check (dates only, brought up to date each night, so the last day can lag by one)".
    - Add, after the `devices` entry:

```ts
  {
    specRow: "device_days",
    specCells: {
      contents: "device hash, UTC day, platform, App Attest key id and highest counter that day",
      linkedTo: "device only",
      retention: "2 days; folded into devices nightly",
    },
    table: {
      name: "device_days",
      columns: ["device_hash", "day", "platform", "attest_key_id", "attest_counter"],
    },
    title: "Days your phone wrote to us",
    what: "For each day (UTC) your phone adds or changes tags or suggests a tag: your phone's hash, whether it's an iPhone or an Android phone and, on iPhone, which App Attest key signed and the highest count it reached that day. Each night these update your phone's record above.",
    linkedTo: "Your phone only. It doesn't mention any meeting.",
    kept: `${String(RETENTION.deviceDayDays)} days: today's and yesterday's are kept, and older ones are deleted in the next nightly cleanup. “Delete all my tags” deletes them at once.`,
  },
```

    Then run `pnpm --filter web exec vitest run privacy-policy`. Expected: PASS.

- **`docs/standards.md`, "Mobile write requests (device headers)":** replace "which records the device in its own transaction (so the devices row never shares an xmin with the write's rows) and runs the write in a new one under the device lock, refusing a blocked device" with:

  "which never writes the devices row: in one transaction under the device lock it only reads `blocked` (refusing a blocked device), notes today in `device_days` (`recordDeviceDay`) and runs the write. `foldDeviceDays()`, first in the nightly maintenance, carries those days into `devices` (new devices, last-seen, the App Attest counter) in one statement. Code that needs a device's record right after its writes (blocking) makes it from `device_days`."

- [ ] **Step 6: The roadmap, and commit.** In `docs/superpowers/plans/2026-09-26-roadmap.md`'s Phase 6 "Later (not scheduled)" bullet, add: "a pending suggestion one transaction id from a tag write links its device to that meeting for up to 30 days (rewrite pending linked suggestions nightly, or accept it; xmin design note, 2026-10-02)".

  Then `pnpm check`, and:

```bash
git add apps/web SPEC.md docs/standards.md docs/superpowers/plans/2026-09-26-roadmap.md
git commit -m "fix(api): the write path stops writing devices; a nightly fold carries device days into it (spec §2)"
```

---

### Task 6: Every write's assertion — `X-Attestation` checked over the exact request

Spec §6: "Each write: iOS sends an App Attest assertion over the SHA-256 of the request body plus timestamp; the server checks the signature and that the counter increased."

Today `verifyAttestation` runs before the route reads the body (finding 1). So `readWriteRequest` takes the body's schema and reads the raw text itself, and the check runs over that text, the method, the path and the clock. The counter is checked again under the device lock and kept on today's `device_days` row, inside the write's transaction; the `devices` row is never written (Task 5A, finding 2).

**Files:**

- Create: `apps/web/test/attested-writes.test.ts`
- Modify:
  - `apps/web/src/server/devices/attestation.ts`, `apps/web/src/server/devices/write-request.ts`, `apps/web/src/server/devices/device-days.ts`, `apps/web/src/server/attest/keys.ts`, `apps/web/src/lib/api/request.ts`
  - `apps/web/src/server/tags/edit.ts` (`deleteTags`), `apps/web/src/server/tags/delete-mine.ts`
  - `apps/web/src/app/api/v1/tags/route.ts`, `apps/web/src/app/api/v1/tags/[meetingId]/route.ts`, `apps/web/src/app/api/v1/tags/delete-mine/route.ts`, `apps/web/src/app/api/v1/suggestions/route.ts`
  - `apps/web/src/content/privacy-inventory.ts`
  - `apps/web/test/attest-fixtures.ts`, `apps/web/test/write-request.test.ts`
  - `docs/standards.md`

**Interfaces:**

- Consumes: `verifyAssertion` (Task 4); `appAttestConfig`, `saveAttestKey` (Task 5); `deviceDays`, `recordDeviceDay`, and a `writeAsDevice` that never writes `devices` (Task 5A); `parseAttestation`, `assertionClientData`, `appAttestHeader` (Task 2).
- Produces:
  - `readWriteRequest<S extends z.ZodType>(req: Request, schema: S): Promise<{ device: WriteDevice; body: z.output<S> }>`;
  - `readDeletionRequest(req: Request): Promise<WriteDevice>` (now async; it reads the empty body for the check);
  - `verifyAttestation(request: { platform: Platform; deviceHash: string; attestation: string | undefined; method: string; path: string; body: string }): Promise<DeviceProof | undefined>`. `DeviceProof = { keyId: string; counter: number }` comes from `@/server/devices/write-request`; the result is undefined while checks are off;
  - `WriteDevice` gains `proof?: DeviceProof`;
  - from `@/server/attest/keys`:
    - `registeredKey(deviceHash: string, keyId: string): Promise<string | null>` (the public key);
    - `highestCounter(deviceHash: string, keyId: string, executor: Executor): Promise<number>` (the folded counter on `devices`, or a higher one on a `device_days` row);
  - `assertFreshCounter(device: WriteDevice, tx: Executor): Promise<void>` from `@/server/devices/device-days`. `recordDeviceDay` now also keeps the proof's key and counter;
  - `parseJsonText<S extends z.ZodType>(text: string, schema: S): z.output<S>` from `@/lib/api/request`;
  - test helpers `stubAppAttest(): void` and `attestedHeaders(key: TestAttestKey, counter: number, request: { method: string; path: string; body: string; timestamp?: number }): Record<string, string>`.

- [ ] **Step 1: Test helpers.** Add to `apps/web/test/attest-fixtures.ts` (importing `vi` from vitest, `appAttestHeader` and `assertionClientData` from `@mymeetingapp/shared`, and `deviceHeaders` from `./tag-fixtures`):

```ts
// Checks switched on, for this app's App ID.
export function stubAppAttest(): void {
  vi.stubEnv("REQUIRE_ATTESTATION", "on");
  vi.stubEnv("APPLE_TEAM_ID", "PVCZBLDJ73");
  vi.stubEnv("APPLE_BUNDLE_ID", "com.goodersoftware.mymeetingapp");
}

// DEVICE_A's write headers with an App Attest proof over exactly this request, as the app's sendWrite builds them.
export function attestedHeaders(
  key: TestAttestKey,
  counter: number,
  request: { method: string; path: string; body: string; timestamp?: number },
): Record<string, string> {
  const timestamp = request.timestamp ?? Date.now();
  const assertion = key.assert(counter, assertionClientData({ ...request, timestamp }));
  return { ...deviceHeaders(), "X-Attestation": appAttestHeader(key.keyId, timestamp, assertion) };
}
```

- [ ] **Step 2: Failing tests.** Create `apps/web/test/attested-writes.test.ts`:

```ts
import { ERROR_MESSAGES } from "@mymeetingapp/shared";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as deleteMineRoute } from "@/app/api/v1/tags/delete-mine/route";
import { POST as tagRoute } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { devices, tagSubmissions } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { saveAttestKey } from "@/server/attest/keys";

import { attestedHeaders, stubAppAttest, type TestAttestKey, testAttestKey } from "./attest-fixtures";
import { resetDb } from "./db";
import { DEVICE_A_HASH, DEVICE_B, deviceHeaders, seedMeetingStarted } from "./tag-fixtures";

const TAGS = "/api/v1/tags";
const DELETE_MINE = "/api/v1/tags/delete-mine";
const HOUR_MS = 3_600_000;
const refusal = { error: { code: "attestation_failed", message: ERROR_MESSAGES.attestation_failed } };

let key: TestAttestKey;
let meetingId: string;
let body: string;

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
  stubAppAttest();
  key = testAttestKey();
  await saveAttestKey({ platform: "ios", deviceHash: DEVICE_A_HASH }, key.keyId, key.publicKey);
  meetingId = await seedMeetingStarted(1);
  body = JSON.stringify({ meetingId, tags: ["quiet"] });
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => pool.end());

function tag(headers: Record<string, string>, text = body) {
  return tagRoute(
    new Request(`http://test${TAGS}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: text,
    }),
  );
}

const signed = (
  counter: number,
  change: { method?: string; path?: string; body?: string; timestamp?: number } = {},
) => attestedHeaders(key, counter, { method: "POST", path: TAGS, body, ...change });

// The highest counter a write kept: on today's device_days row (Task 5A), never on the device's record.
const storedCounter = async () => {
  const { rows } = await db.execute<{ highest: string | null }>(
    sql`select max(attest_counter)::text as highest from device_days`,
  );
  return Number(rows[0]?.highest ?? 0);
};
const savedTags = async () => (await db.select().from(tagSubmissions)).length;

describe("a write while app checks are required", () => {
  it("is accepted when signed over its exact method, path, clock and body, and keeps the new counter", async () => {
    expect((await tag(signed(1))).status).toBe(201);
    expect(await storedCounter()).toBe(1);
    expect(await savedTags()).toBe(1);
  });

  it.each<[string, () => Record<string, string>, string?]>([
    ["no X-Attestation", () => deviceHeaders()],
    ["a header that isn't a proof", () => ({ ...deviceHeaders(), "X-Attestation": "assertion" })],
    [
      "a body other than the one signed",
      () => signed(1),
      JSON.stringify({ meetingId: "", tags: ["lively"] }),
    ],
    ["a proof signed for another path", () => signed(1, { path: "/api/v1/suggestions" })],
    ["a proof signed for another method", () => signed(1, { method: "PUT" })],
    [
      "a key this phone never registered",
      () => attestedHeaders(testAttestKey(), 1, { method: "POST", path: TAGS, body }),
    ],
    ["a phone clock 25 hours behind", () => signed(1, { timestamp: Date.now() - 25 * HOUR_MS })],
  ])("is refused, and nothing saved, with %s", async (_why, headers, text) => {
    const res = await tag(headers(), text);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(refusal);
    expect(await savedTags()).toBe(0);
    expect(await storedCounter()).toBe(0);
  });

  it("accepts a phone clock 23 hours off and refuses one 25 hours off", async () => {
    expect((await tag(signed(1, { timestamp: Date.now() + 23 * HOUR_MS }))).status).toBe(201);
    const other = await seedMeetingStarted(2);
    const later = JSON.stringify({ meetingId: other, tags: ["quiet"] });
    expect((await tag(signed(2, { body: later, timestamp: Date.now() + 25 * HOUR_MS }), later)).status).toBe(
      401,
    );
  });

  it("refuses an assertion whose counter isn't above the last one, so a replay fails", async () => {
    const headers = signed(1);
    expect((await tag(headers)).status).toBe(201);
    expect(await (await tag(headers)).json()).toEqual(refusal);
  });

  it("lets a retried write through when it signs again with the next counter", async () => {
    expect((await tag(signed(1))).status).toBe(201);
    // The tag already exists, so the server's answer moves on to its own rules: the check passed.
    expect(await (await tag(signed(2))).json()).toMatchObject({ error: { code: "already_tagged" } });
  });

  it("lets only one of two writes signed with the same counter through", async () => {
    const other = await seedMeetingStarted(2);
    const second = JSON.stringify({ meetingId: other, tags: ["quiet"] });
    const statuses = await Promise.all([tag(signed(1)), tag(signed(1, { body: second }), second)]);
    expect(statuses.map((res) => res.status).sort()).toEqual([201, 401]);
    expect(await storedCounter()).toBe(1);
  });

  it("keeps the counter on today's device_days row and never writes the device's record (Task 5A)", async () => {
    const stamps = async () =>
      (await db.execute<{ xmin: string; xmax: string }>(sql`select xmin::text, xmax::text from devices`))
        .rows;
    const before = await stamps();
    expect((await tag(signed(1))).status).toBe(201);
    expect(await stamps()).toEqual(before);
    expect(await storedCounter()).toBe(1);
  });

  it("checks deletions too, over their empty body", async () => {
    const deleteMine = (headers: Record<string, string>) =>
      deleteMineRoute(new Request(`http://test${DELETE_MINE}`, { method: "POST", headers }));
    expect((await deleteMine(deviceHeaders())).status).toBe(401);
    expect((await deleteMine(signed(1, { path: DELETE_MINE, body: "" }))).status).toBe(200);
  });

  it("refuses Android until Play Integrity arrives in Phase 6b", async () => {
    expect((await tag(deviceHeaders(DEVICE_B, "android"))).status).toBe(401);
  });
});

describe("a write while app checks are off", () => {
  it("ignores X-Attestation entirely", async () => {
    vi.stubEnv("REQUIRE_ATTESTATION", "off");
    expect((await tag({ ...deviceHeaders(), "X-Attestation": "not a proof" })).status).toBe(201);
  });
});
```

In `test/write-request.test.ts`, change the reduced route to read a body:

```ts
const write = withErrors(async (req: Request) => {
  const { device } = await readWriteRequest(req, z.object({}));
  await writeAsDevice(device, () => Promise.resolve());
  return jsonResponse(z.object({ deviceHash: z.string() }), device, "none");
});

function call(headers: Record<string, string>) {
  return write(new Request("http://test/api/v1/tags", { method: "POST", headers, body: "{}" }));
}
```

and rename "refuses every write while attestation is required and no verifier exists" to "refuses a write with no valid proof while attestation is required" (its body stays).

Run `pnpm --filter web exec vitest run attested-writes write-request`. Expected: FAIL; `readWriteRequest` takes no schema yet and nothing verifies an assertion.

- [ ] **Step 3: Keys, body text and the check.** Add to `src/server/attest/keys.ts` (importing `sql` from drizzle-orm, `type Executor` from `@/db/client` and `deviceDays` from `@/db/schema`):

```ts
// The phone's registered public key, when keyId is it.
export async function registeredKey(deviceHash: string, keyId: string): Promise<string | null> {
  const [row] = await db
    .select({ publicKey: devices.attestPublicKey })
    .from(devices)
    .where(and(eq(devices.deviceHash, deviceHash), eq(devices.attestKeyId, keyId)));
  return row?.publicKey ?? null;
}

// The highest counter this key is known to have signed: the folded one on the device's record, or a higher one on a
// device_days row (Task 5A: a write keeps its counter there, never on devices). 0 for a key with neither.
export async function highestCounter(deviceHash: string, keyId: string, executor: Executor): Promise<number> {
  const { rows } = await executor.execute<{ highest: string | null }>(sql`
    select greatest(
      (select max(attest_counter) from ${deviceDays} where device_hash = ${deviceHash} and attest_key_id = ${keyId}),
      (select attest_counter from ${devices} where device_hash = ${deviceHash} and attest_key_id = ${keyId})
    )::text as highest
  `);
  return Number(rows[0]?.highest ?? 0);
}
```

In `src/lib/api/request.ts`, split the parse out of `readJsonBody`:

```ts
export function parseJsonText<Schema extends z.ZodType>(text: string, schema: Schema): z.output<Schema> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError("invalid_request");
  }
  return parseInput(schema, body);
}

export async function readJsonBody<Schema extends z.ZodType>(
  req: Request,
  schema: Schema,
): Promise<z.output<Schema>> {
  return parseJsonText(await req.text(), schema);
}
```

Replace `src/server/devices/attestation.ts` with:

```ts
import {
  assertionClientData,
  type AttestationProof,
  parseAttestation,
  type Platform,
} from "@mymeetingapp/shared";

import { readEnv } from "@/env";
import { ApiError } from "@/lib/api/respond";
import { verifyAssertion } from "@/server/attest/app-attest";
import { appAttestConfig } from "@/server/attest/config";
import { db } from "@/db/client";
import { highestCounter, registeredKey } from "@/server/attest/keys";
import type { DeviceProof } from "@/server/devices/write-request";

// The counter, not the clock, stops replays; the clock only stops an assertion being held for days, and a tighter
// window would refuse phones whose time is wrong (decision 3).
const CLOCK_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface AttestedRequest {
  platform: Platform;
  deviceHash: string;
  attestation: string | undefined;
  method: string;
  path: string;
  // The raw body text, exactly as received: the assertion signs these bytes.
  body: string;
}

// Spec §6: verification sits behind REQUIRE_ATTESTATION so development works without it. Only "off" (or unset)
// turns it off, so a mistyped value fails closed.
function attestationRequired(): boolean {
  const value = readEnv("REQUIRE_ATTESTATION")?.toLowerCase();
  if (value === undefined || value === "off") return false;
  if (value !== "on") console.warn('[attestation] REQUIRE_ATTESTATION should be "on" or "off"; requiring it');
  return true;
}

// Checks the assertion and returns the key and counter it carries. The counter is checked here against what's known,
// and again under the device lock in the write's own transaction (assertFreshCounter), where it is kept on today's
// device_days row: of two writes signed with one counter, only the first through the lock gets past.
async function verifyAppAttest(
  request: AttestedRequest,
  proof: Extract<AttestationProof, { kind: "appAttest" }>,
): Promise<DeviceProof> {
  const config = appAttestConfig();
  const publicKey = await registeredKey(request.deviceHash, proof.keyId);
  if (config === null || publicKey === null || Math.abs(Date.now() - proof.timestamp) > CLOCK_WINDOW_MS) {
    throw new ApiError("attestation_failed");
  }
  const counter = verifyAssertion({
    assertion: proof.assertion,
    clientData: assertionClientData({
      method: request.method,
      path: request.path,
      timestamp: proof.timestamp,
      body: request.body,
    }),
    publicKey,
    appId: config.appId,
    storedCounter: await highestCounter(request.deviceHash, proof.keyId, db),
  });
  return { keyId: proof.keyId, counter };
}

// Spec §6: an iPhone's write carries an App Attest assertion over this exact request. Play Integrity arrives in Phase
// 6b, so until then a required check refuses Android. Off, the header is ignored entirely and there's no proof.
export async function verifyAttestation(request: AttestedRequest): Promise<DeviceProof | undefined> {
  if (!attestationRequired()) return undefined;
  const proof = request.attestation === undefined ? null : parseAttestation(request.attestation);
  if (request.platform !== "ios" || proof?.kind !== "appAttest") throw new ApiError("attestation_failed");
  return verifyAppAttest(request, proof);
}
```

In `src/server/devices/write-request.ts`, replace `verifiedDevice`, `readWriteRequest` and `readDeletionRequest` with the following, and have `identifyDevice` (Task 5) build its result with `hashed(readDeviceHeaders(req))`. Import `parseJsonText` from `@/lib/api/request` and `type z` from zod.

```ts
function hashed(headers: WriteHeaders): WriteDevice {
  return { platform: headers.platform, deviceHash: deviceHash(headers.platform, headers.deviceId) };
}

// The raw id is hashed here and goes nowhere else: not into the database, the response or a log. The attestation is
// checked over the request's exact method, path and body text.
async function verifiedDevice(req: Request, headers: WriteHeaders, body: string): Promise<WriteDevice> {
  const device = hashed(headers);
  const proof = await verifyAttestation({
    ...device,
    attestation: headers.attestation,
    method: req.method,
    path: new URL(req.url).pathname,
    body,
  });
  return proof === undefined ? device : { ...device, proof };
}

// Spec §7: every write carries X-Device-Id, X-Platform, X-App-Version and (when required) X-Attestation, and an app
// below the platform's minimum version must upgrade first. The body is read here, as text, because the attestation
// signs its exact bytes; it is parsed with `schema` only after the check.
export async function readWriteRequest<Schema extends z.ZodType>(
  req: Request,
  schema: Schema,
): Promise<{ device: WriteDevice; body: z.output<Schema> }> {
  const headers = readDeviceHeaders(req);
  if (isOlderVersion(headers.appVersion, readAppConfig().minSupportedVersion[headers.platform])) {
    throw new ApiError("upgrade_required");
  }
  const text = await req.text();
  const device = await verifiedDevice(req, headers, text);
  return { device, body: parseJsonText(text, schema) };
}

// A write that only deletes the device's own data. Spec §5 allows deletes at any time and §2 puts privacy over
// convenience, so no app version is too old to delete. The device is identified and attested exactly as for any
// write (over an empty body), so a forged id can't delete another device's data. Pair it with lockDevice.
export async function readDeletionRequest(req: Request): Promise<WriteDevice> {
  return verifiedDevice(req, readDeviceHeaders(req), await req.text());
}
```

In `src/server/devices/write-request.ts`, also give `WriteDevice` its proof:

```ts
// The App Attest key and counter a write's assertion carried, once verified (Task 6); absent while checks are off.
export interface DeviceProof {
  keyId: string;
  counter: number;
}

export interface WriteDevice {
  platform: Platform;
  deviceHash: string;
  proof?: DeviceProof;
}
```

In `src/server/devices/device-days.ts` (Task 5A), check the counter again under the device lock and keep it on today's row. Import `ApiError` from `@/lib/api/respond` and `highestCounter` from `@/server/attest/keys`, then replace `recordDeviceDay` with:

```ts
// Spec §6: an assertion's counter must exceed every one its key signed before. Called under the device lock, inside the
// write's transaction, so of two writes signed with one counter only the first through the lock gets past. Without a
// proof (checks off, or a DeviceCheck token) there's nothing to check.
export async function assertFreshCounter(device: WriteDevice, tx: Executor): Promise<void> {
  if (device.proof === undefined) return;
  const highest = await highestCounter(device.deviceHash, device.proof.keyId, tx);
  if (device.proof.counter <= highest) throw new ApiError("attestation_failed");
}

// As before (Task 5A), plus the proof: today's row keeps the key and the highest counter it signed, which the nightly
// fold carries into the device's record. Never the devices row itself (spec §2). A write the server then refuses rolls
// this back with it, so a replay of a write that failed isn't caught; it fails again on its own, inside the 24-hour
// clock window.
export async function recordDeviceDay(device: WriteDevice, tx: Executor): Promise<void> {
  await assertFreshCounter(device, tx);
  const row = { deviceHash: device.deviceHash, day: utcToday, platform: device.platform };
  if (device.proof === undefined) {
    await tx.insert(deviceDays).values(row).onConflictDoNothing();
    return;
  }
  const key = { attestKeyId: device.proof.keyId, attestCounter: device.proof.counter };
  await tx
    .insert(deviceDays)
    .values({ ...row, ...key })
    .onConflictDoUpdate({ target: [deviceDays.deviceHash, deviceDays.day], set: key });
}
```

Deletions take the device lock themselves (`lockDevice`) and note no day. They check the counter but don't keep it, since replaying a deletion deletes nothing more. In `src/server/tags/edit.ts`'s `deleteTags` and in `src/server/tags/delete-mine.ts`, add `await assertFreshCounter(device, tx);` right after `await lockDevice(device.deviceHash, tx);`.

- [ ] **Step 4: The routes.** Each write route now gets its body from `readWriteRequest`:

```ts
// src/app/api/v1/tags/route.ts
export const POST = withErrors(async (req: Request) => {
  assertFeatureEnabled("tagging");
  const { device, body } = await readWriteRequest(req, TagSubmissionRequest);
  return jsonResponse(TagWriteResponse, await submitTags(device, body), "none", 201);
});
```

```ts
// src/app/api/v1/tags/[meetingId]/route.ts
export const PUT = withErrors(async (req: Request, context: Context) => {
  assertFeatureEnabled("tagging");
  const { meetingId } = parseInput(Params, await context.params);
  const { device, body } = await readWriteRequest(req, TagEditRequest);
  return jsonResponse(TagWriteResponse, await editTags(device, meetingId, body), "none");
});

// No feature switch and no minimum app version: deleting your tags always works.
export const DELETE = withErrors(async (req: Request, context: Context) => {
  const device = await readDeletionRequest(req);
  const { meetingId } = parseInput(Params, await context.params);
  return jsonResponse(TagWriteResponse, await deleteTags(device, meetingId), "none");
});
```

```ts
// src/app/api/v1/tags/delete-mine/route.ts
export const POST = withErrors(async (req: Request) =>
  jsonResponse(DeleteMineResponse, await deleteMine(await readDeletionRequest(req)), "none"),
);
```

```ts
// src/app/api/v1/suggestions/route.ts
export const POST = withErrors(async (req: Request) => {
  assertFeatureEnabled("suggestions");
  const { device, body } = await readWriteRequest(req, SuggestionRequest);
  await submitSuggestion(device, body.text);
  return jsonResponse(SuggestionResponse, { status: "received" }, "none", 202);
});
```

Remove the now-unused `readJsonBody` imports from the tags, `[meetingId]` and suggestions routes.

In `src/content/privacy-inventory.ts`, the Apple entry's `role`: replace "and, once switched on, App Attest and DeviceCheck confirm that requests come from the real app." with "and App Attest (or DeviceCheck, on an iPhone without it) confirms that tags and suggestions come from the real app."

- [ ] **Step 5: Run every write's tests.**

```bash
pnpm --filter web exec vitest run attested-writes write-request request tags-route tag-edit-routes delete-mine-route suggestions-route maintenance privacy-policy device-days
```

Expected: PASS, with the existing route suites unchanged (they run with checks off).

- [ ] **Step 6: Standards and commit.** In `docs/standards.md`:
  - "Request input": add "A write's body is read by `readWriteRequest(req, schema)`, which needs the raw text for the attestation (`parseJsonText`); routes never read a write's body themselves."
  - "Mobile write requests (device headers)": replace "`readWriteRequest(req)` then `writeAsDevice(device, …)`" with "`const { device, body } = await readWriteRequest(req, schema)` then `writeAsDevice(device, …)`", and "`readDeletionRequest(req)`" with "`await readDeletionRequest(req)`". Add: "Both check `X-Attestation` over the exact method, path and body (`verifyAttestation`). The counter is checked again under the device lock (`assertFreshCounter`). A write keeps it on today's `device_days` row (Task 5A), never on `devices`."

  Then `pnpm check`, and:

```bash
git add apps/web docs/standards.md
git commit -m "feat(api): check every write's App Attest assertion over its exact method, path and body"
```

---

### Task 7: The DeviceCheck fallback

An iPhone whose `DCAppAttestService.isSupported` is false sends `devicecheck.v1.<token>`. The server asks Apple whether the token is real (`POST /v1/validate_device_token`), authenticating with a provider token: an ES256 JWT with `kid` = the key ID and `iss` = the team ID, signed with the `.p8` the owner made in Task 1.

The token proves less than an assertion: a real Apple device running this team's app, but not this exact request. So a phone that has registered an App Attest key can't fall back to it (decision 8). An outage on Apple's side is a `server_error`, logged by status only (Review Focus 5).

**Files:**

- Create: `apps/web/src/server/attest/device-check.ts`, `apps/web/test/device-check.test.ts`
- Modify: `apps/web/src/server/devices/attestation.ts`, `apps/web/src/server/attest/keys.ts`, `apps/web/src/env.ts`, `SPEC.md` §12, `docs/standards.md`

**Interfaces:**

- Consumes: `appAttestConfig` (Task 5), `verifyAttestation` (Task 6), `deviceCheckHeader` (Task 2).
- Produces:
  - `validDeviceCheckToken(token: string): Promise<boolean>` from `@/server/attest/device-check`: true when Apple accepts the token (200), false when it refuses it (400) or the key isn't configured; it throws on anything else;
  - `hasAttestKey(deviceHash: string): Promise<boolean>` from `@/server/attest/keys`;
  - env names `DEVICECHECK_KEY_ID`, `DEVICECHECK_PRIVATE_KEY`, `DEVICECHECK_API_URL` (the last only to point tests at `@mymeetingapp/test-server`; unset, the host follows `APP_ATTEST_ENVIRONMENT`).

- [ ] **Step 1: Failing tests.** Create `apps/web/test/device-check.test.ts`:

```ts
import { generateKeyPairSync, verify } from "node:crypto";
import { format } from "node:util";

import { deviceCheckHeader, ERROR_MESSAGES } from "@mymeetingapp/shared";
import { startServer } from "@mymeetingapp/test-server";
import { z } from "zod";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as tagRoute } from "@/app/api/v1/tags/route";
import { pool } from "@/db/client";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { saveAttestKey } from "@/server/attest/keys";

import { stubAppAttest, testAttestKey } from "./attest-fixtures";
import { resetDb } from "./db";
import { DEVICE_A_HASH, deviceHeaders, seedMeetingStarted } from "./tag-fixtures";

const TOKEN = "AgAAAHRlc3QgZGV2aWNlIHRva2Vu";
// A real P-256 key standing in for the owner's .p8 (PKCS#8 PEM, as Apple issues it).
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const ValidateBody = z.strictObject({
  device_token: z.string(),
  transaction_id: z.uuid(),
  timestamp: z.number().int(),
});

let meetingId: string;
beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
  stubAppAttest();
  vi.stubEnv("DEVICECHECK_KEY_ID", "ABC123DEFG");
  vi.stubEnv("DEVICECHECK_PRIVATE_KEY", privateKey.export({ format: "pem", type: "pkcs8" }).toString());
  meetingId = await seedMeetingStarted(1);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => pool.end());

// Apple's validate endpoint, answering every request with `status`.
async function apple(status: number) {
  const server = await startServer(() => ({ status, body: status === 200 ? "" : "Bad Device Token" }));
  vi.stubEnv("DEVICECHECK_API_URL", server.baseUrl);
  return server;
}

function tag() {
  return tagRoute(
    new Request("http://test/api/v1/tags", {
      method: "POST",
      headers: {
        ...deviceHeaders(),
        "X-Attestation": deviceCheckHeader(TOKEN),
        "content-type": "application/json",
      },
      body: JSON.stringify({ meetingId, tags: ["quiet"] }),
    }),
  );
}

describe("a write from an iPhone without App Attest", () => {
  it("is accepted when Apple accepts its DeviceCheck token, asked with a provider token signed by our key", async () => {
    const server = await apple(200);
    expect((await tag()).status).toBe(201);
    const [request] = server.requests;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/v1/validate_device_token");
    expect(ValidateBody.parse(JSON.parse(request?.body ?? "")).device_token).toBe(TOKEN);
    const [header = "", claims = "", signature = ""] = (request?.headers.authorization ?? "")
      .replace(/^Bearer /, "")
      .split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "ABC123DEFG",
    });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({ iss: "PVCZBLDJ73" });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
    await server.close();
  });

  it("is refused when Apple refuses the token", async () => {
    const server = await apple(400);
    const res = await tag();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "attestation_failed", message: ERROR_MESSAGES.attestation_failed },
    });
    await server.close();
  });

  it("answers server_error and logs only the status when Apple's DeviceCheck fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = await apple(503);
    const res = await tag();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "server_error" } });
    const logged = error.mock.calls.map((args) => format(...args)).join("\n");
    expect(logged).toContain("DeviceCheck answered 503");
    expect(logged).not.toContain(TOKEN);
    await server.close();
  });

  it("is refused, without asking Apple, from a phone that registered an App Attest key", async () => {
    const key = testAttestKey();
    await saveAttestKey({ platform: "ios", deviceHash: DEVICE_A_HASH }, key.keyId, key.publicKey);
    const server = await apple(200);
    expect((await tag()).status).toBe(401);
    expect(server.requests).toEqual([]);
    await server.close();
  });

  it("is refused, with a warning, while the DeviceCheck key isn't configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("DEVICECHECK_PRIVATE_KEY", undefined);
    const server = await apple(200);
    expect((await tag()).status).toBe(401);
    expect(server.requests).toEqual([]);
    expect(warn.mock.calls.map((args) => format(...args)).join("\n")).toContain(
      "DEVICECHECK_KEY_ID and DEVICECHECK_PRIVATE_KEY must be set",
    );
    await server.close();
  });
});
```

Run `pnpm --filter web exec vitest run device-check`. Expected: FAIL; a DeviceCheck proof is refused before Apple is asked.

- [ ] **Step 2: The client.** Add `| "DEVICECHECK_KEY_ID" | "DEVICECHECK_PRIVATE_KEY" | "DEVICECHECK_API_URL"` to `EnvName` in `src/env.ts`. Add to `src/server/attest/keys.ts`:

```ts
export async function hasAttestKey(deviceHash: string): Promise<boolean> {
  const [row] = await db
    .select({ keyId: devices.attestKeyId })
    .from(devices)
    .where(eq(devices.deviceHash, deviceHash));
  return row !== undefined && row.keyId !== null;
}
```

Create `apps/web/src/server/attest/device-check.ts`:

```ts
import { createPrivateKey, randomUUID, sign } from "node:crypto";

import { readEnv } from "@/env";
import type { AppAttestEnvironment } from "@/server/attest/app-attest";
import { appAttestConfig } from "@/server/attest/config";

const APPLE_HOSTS: Record<AppAttestEnvironment, string> = {
  production: "https://api.devicecheck.apple.com",
  development: "https://api.development.devicecheck.apple.com",
};
const TIMEOUT_MS = 10_000;

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

// Apple's provider token, as for APNs: ES256 over {alg, kid} and {iss: team id, iat}, signed with the DeviceCheck key.
function providerToken(privateKey: string, keyId: string, teamId: string): string {
  const unsigned = `${base64url(JSON.stringify({ alg: "ES256", kid: keyId }))}.${base64url(
    JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }),
  )}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: createPrivateKey(privateKey),
    dsaEncoding: "ieee-p1363",
  });
  return `${unsigned}.${base64url(signature)}`;
}

// Spec §6: an iPhone without App Attest proves it's a real Apple device running this team's app with a one-time
// DeviceCheck token, which only Apple can check. False when Apple refuses the token or no key is configured (a
// misconfiguration, warned); anything else from Apple throws, so the request is a server error rather than the phone's
// fault. Neither the token nor Apple's reply is ever logged.
export async function validDeviceCheckToken(token: string): Promise<boolean> {
  const config = appAttestConfig();
  const keyId = readEnv("DEVICECHECK_KEY_ID");
  const privateKey = readEnv("DEVICECHECK_PRIVATE_KEY");
  if (config === null || keyId === undefined || privateKey === undefined) {
    console.warn(
      "[attestation] DEVICECHECK_KEY_ID and DEVICECHECK_PRIVATE_KEY must be set; refusing DeviceCheck tokens",
    );
    return false;
  }
  const host = readEnv("DEVICECHECK_API_URL") ?? APPLE_HOSTS[config.environment];
  const response = await fetch(`${host}/v1/validate_device_token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${providerToken(privateKey, keyId, config.teamId)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ device_token: token, transaction_id: randomUUID(), timestamp: Date.now() }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 200) return true;
  if (response.status === 400) return false;
  throw new Error(`DeviceCheck answered ${String(response.status)}`);
}
```

In `src/server/devices/attestation.ts`, import `hasAttestKey` and `validDeviceCheckToken`, and replace `verifyAttestation`'s body after `proof` is read with:

```ts
if (request.platform !== "ios" || proof === null) throw new ApiError("attestation_failed");
if (proof.kind === "appAttest") return verifyAppAttest(request, proof);
// DeviceCheck proves less than an assertion (decision 8): a phone with an App Attest key can't fall back to it.
if ((await hasAttestKey(request.deviceHash)) || !(await validDeviceCheckToken(proof.token))) {
  throw new ApiError("attestation_failed");
}
// A DeviceCheck token carries no counter, so the write keeps nothing but its day (Task 5A).
return undefined;
```

and update its comment: "An iPhone's write carries an App Attest assertion over this exact request, or, on an iPhone without App Attest, a DeviceCheck token."

- [ ] **Step 3: Run.** `pnpm --filter web exec vitest run device-check attested-writes`. Expected: PASS.

- [ ] **Step 4: Spec, standards, commit.**
  - **`SPEC.md` §12, Secrets:** replace "Apple App Attest team/bundle IDs" with "`APPLE_TEAM_ID`, `APPLE_BUNDLE_ID` and `APP_ATTEST_ENVIRONMENT` (App Attest), `DEVICECHECK_KEY_ID` and `DEVICECHECK_PRIVATE_KEY` (the DeviceCheck `.p8`, production only)".
  - **`docs/standards.md`:** add a row after "Authenticated JSON calls to first-party infrastructure APIs at build time":

    ```markdown
    | Calls to Apple's DeviceCheck API | `validDeviceCheckToken(token)` from `@/server/attest/device-check` (ES256 provider token, 10-second timeout, status-only errors); tests point `DEVICECHECK_API_URL` at `@mymeetingapp/test-server` | review, `device-check.test.ts` |
    ```

  Then `pnpm check`, and:

```bash
git add apps/web SPEC.md docs/standards.md
git commit -m "feat(api): DeviceCheck fallback for iPhones without App Attest"
```

---

### Task 8: The app attests its writes

The phone's half, in three layers:

- **`modules/app-integrity`** (Swift): App Attest's `generateKey`, `attestKey` and `generateAssertion`, and DeviceCheck's `generateToken`. Each challenge or text is hashed with SHA-256 into the client data hash Apple signs.
- **`src/device/app-integrity.ts`:** keeps the key ID in the Keychain beside the phone's ID, says what this phone can prove, and turns `invalidKey` into `StaleAttestKey`.
- **`sendWrite`:**
  - writes one at a time;
  - registers a key on the first write;
  - signs every write with `assertionClientData`;
  - sends DeviceCheck where App Attest isn't offered;
  - replaces a refused key once;
  - sends without a proof whatever stops it (decisions 4–6).

`deleteMine` forgets the key, because the server deleted it.

The module is iOS-only (`requireOptionalNativeModule` gives null on Android). Jest fakes it at its package boundary, and a simulator build (where App Attest isn't supported) checks it compiles. Task 14 runs it on a real iPhone.

**Files:**

- Create:
  - `apps/mobile/modules/app-integrity/expo-module.config.json`, `apps/mobile/modules/app-integrity/index.ts`
  - `apps/mobile/modules/app-integrity/ios/AppIntegrityModule.swift`, `apps/mobile/modules/app-integrity/ios/AppIntegrity.podspec`
  - `apps/mobile/src/device/app-integrity.ts`
  - `apps/mobile/test/native/app-integrity.ts`, `apps/mobile/test/attestation.test.ts`
- Modify:
  - `apps/mobile/src/api/client.ts`, `apps/mobile/src/api/writes.ts`, `apps/mobile/app.config.ts`, `apps/mobile/jest.config.js`
  - `apps/mobile/test/native/expo-secure-store.ts`, `apps/mobile/test/api-server.ts`, `apps/mobile/test/setup.ts`
  - `apps/mobile/test/writes.test.ts`, `apps/mobile/test/app-shell.test.tsx`
  - `eslint.config.js`, `docs/standards.md`

**Interfaces:**

- Consumes: `appAttestHeader`, `deviceCheckHeader`, `parseAttestation`, `assertionClientData`, `AttestChallengeResponse`, `AttestRegisterRequest`, `AttestRegisterResponse`, `DEVICE_HEADERS` (shared); `writeHeaders` (5b); `withinTimeLimit` from `@/location/time-limit`.
- Produces:
  - `@modules/app-integrity` default export: `AppIntegrityModule | null`, with `isAppAttestSupported: boolean`, `isDeviceCheckSupported: boolean`, `generateKey(): Promise<string>`, `attestKey(keyId: string, challenge: string): Promise<string>`, `generateAssertion(keyId: string, clientData: string): Promise<string>`, `deviceCheckToken(): Promise<string>`. Errors carry `code` `"ERR_INVALID_KEY"` (the key is gone) or `"ERR_APP_INTEGRITY"`.
  - From `@/device/app-integrity`:
    - `type IntegritySupport = "appAttest" | "deviceCheck" | "none"`, `class StaleAttestKey`, `integritySupport(): IntegritySupport`;
    - `savedAttestKey(): Promise<string | null>`, `rememberAttestKey(keyId: string): Promise<void>`, `forgetAttestKey(): Promise<void>`;
    - `newAttestKey(): Promise<string>`, `attestKey(keyId: string, challenge: string): Promise<string>`, `assertion(keyId: string, clientData: string): Promise<string>`, `deviceCheckToken(): Promise<string>`.
  - `sendWrite` keeps its signature.
  - Test helpers:
    - from `test/native/app-integrity`: `setIntegrity("appAttest" | "deviceCheck" | "none")`, `setAttestTrouble("none" | "unavailable")`, `makeKeyStale(keyId)`, `keyIdFor(n)`, `signedClientData`, `attestedChallenges`, `resetIntegrity()`;
    - `TestApi.replyOnce(path, json, status?, method?)`;
    - `deleteItemAsync` in the secure-store fake.

- [ ] **Step 1: The fake, the test helpers and the failing tests.** Create `apps/mobile/test/native/app-integrity.ts`:

```ts
// The local module @modules/app-integrity, as App Attest and DeviceCheck answer the app. A test says what this phone
// supports and how Apple answers. Keys and proofs are readable base64 strings, and every signed text is recorded.
type Support = "appAttest" | "deviceCheck" | "none";

// "none" by default, as on the simulator: tests that aren't about app checks see the writes they always saw.
let support: Support = "none";
let keysMade = 0;
let attestTrouble: "none" | "unavailable" = "none";
const staleKeys = new Set<string>();
// Each text an assertion signed, oldest first.
export const signedClientData: string[] = [];
// Each challenge a key was attested over, oldest first.
export const attestedChallenges: string[] = [];

// The nth key this phone makes: 32 bytes of n, base64, shaped like Apple's key ids.
export const keyIdFor = (n: number) => Buffer.alloc(32, n).toString("base64");

export function setIntegrity(next: Support): void {
  support = next;
}
// "unavailable": Apple's attestation server can't be reached (DCError.serverUnavailable).
export function setAttestTrouble(next: typeof attestTrouble): void {
  attestTrouble = next;
}
// The key is gone from the Secure Enclave, as after a reinstall: assertions with it fail as DCError.invalidKey does.
export function makeKeyStale(keyId: string): void {
  staleKeys.add(keyId);
}
export function resetIntegrity(): void {
  support = "none";
  keysMade = 0;
  attestTrouble = "none";
  staleKeys.clear();
  signedClientData.length = 0;
  attestedChallenges.length = 0;
}

const failure = (code: string) => Object.assign(new Error(`[AppIntegrity] ${code}`), { code });

export default {
  get isAppAttestSupported(): boolean {
    return support === "appAttest";
  },
  get isDeviceCheckSupported(): boolean {
    return support !== "none";
  },
  generateKey(): Promise<string> {
    keysMade += 1;
    return Promise.resolve(keyIdFor(keysMade));
  },
  attestKey(keyId: string, challenge: string): Promise<string> {
    attestedChallenges.push(challenge);
    if (attestTrouble === "unavailable") return Promise.reject(failure("ERR_APP_INTEGRITY"));
    return Promise.resolve(Buffer.from(`attestation of ${keyId}`).toString("base64"));
  },
  generateAssertion(keyId: string, clientData: string): Promise<string> {
    if (staleKeys.has(keyId)) return Promise.reject(failure("ERR_INVALID_KEY"));
    signedClientData.push(clientData);
    return Promise.resolve(Buffer.from(`assertion ${String(signedClientData.length)}`).toString("base64"));
  },
  deviceCheckToken(): Promise<string> {
    return Promise.resolve(Buffer.from("device check token").toString("base64"));
  },
};
```

Add to `test/native/expo-secure-store.ts`:

```ts
export function deleteItemAsync(key: string): Promise<void> {
  if (trouble === "fails") return Promise.reject(new Error("Keychain unavailable"));
  items.delete(key);
  return Promise.resolve();
}
```

In `test/api-server.ts`, add to `TestApi`:

```ts
  // Answers only the next request on this path (and method), as a server that changes its answer; later requests get
  // what reply() set.
  replyOnce(path: string, json: unknown, status?: number, method?: string): void;
```

Implement it with a second map of queues, checked first in the handler:

```ts
  const once = new Map<string, { status: number; json: unknown }[]>();
  // ...inside the handler, before `replies.get`:
      const queued = once.get(`${method} ${path}`)?.shift() ?? once.get(path)?.shift();
      if (queued !== undefined) return jsonReply(queued.status, queued.json);
  // ...and in the returned object:
    replyOnce: (path, json, status = 200, method) => {
      const key = method === undefined ? path : `${method} ${path}`;
      once.set(key, [...(once.get(key) ?? []), { status, json }]);
    },
```

In `jest.config.js`'s `moduleNameMapper`, before `^@modules/native-location$`, add `"^@modules/app-integrity$": "<rootDir>/test/native/app-integrity.ts",`. In `test/setup.ts`'s `beforeEach`, add `resetIntegrity();` (imported from `./native/app-integrity`).

Create `apps/mobile/test/attestation.test.ts`:

```ts
import { ERROR_MESSAGES } from "@mymeetingapp/shared";
import { Platform } from "react-native";

import { deleteMine, editTags, submitTags, suggestTag } from "@/api/writes";

import { startApi, type TestApi } from "./api-server";
import { setNow } from "./clock";
import {
  attestedChallenges,
  keyIdFor,
  makeKeyStale,
  setAttestTrouble,
  setIntegrity,
  signedClientData,
} from "./native/app-integrity";
import { keychainItem, setKeychainItem, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from "./native/expo-secure-store";

const MEETING_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const CHALLENGE = "q3Jw0F2nYc5yQ0d1Gk7mR8sT9uV0wX1yZ2aB3cD4eF5";
const ANSWER = { meetingId: MEETING_ID, tags: [] };
const REFUSED = { error: { code: "attestation_failed", message: ERROR_MESSAGES.attestation_failed } };
const base64 = (text: string) => Buffer.from(text).toString("base64");
const tagIt = () => submitTags({ meetingId: MEETING_ID, tags: ["quiet"] });

let api: TestApi;
beforeEach(async () => {
  setIntegrity("appAttest");
  api = await startApi();
  // Each path has one method here, so replies are by path: answerLater(path) can then replace one.
  api.reply("/api/v1/attest/challenge", { challenge: CHALLENGE }, 201);
  api.reply("/api/v1/attest/register", { registered: true }, 201);
  api.reply("/api/v1/tags", ANSWER, 201);
  api.reply(`/api/v1/tags/${MEETING_ID}`, ANSWER);
  api.reply("/api/v1/tags/delete-mine", { deletedTags: 0 });
  api.reply("/api/v1/suggestions", { status: "received" }, 202);
});
afterEach(async () => {
  await api.close();
});

const sent = () => api.requests.map((request) => `${request.method} ${request.path}`);
const proofOf = (n: number) => api.requests[n]?.headers["x-attestation"];
const REGISTERING = ["POST /api/v1/attest/challenge", "POST /api/v1/attest/register"];

describe("on an iPhone with App Attest", () => {
  it("makes and registers a key on the first write, then signs exactly that write", async () => {
    setNow("2026-10-05T12:00:00Z");
    await tagIt();
    expect(sent()).toEqual([...REGISTERING, "POST /api/v1/tags"]);
    const [challenge, register, write] = api.requests;
    // The app check's own requests carry the device headers, but no proof.
    expect(challenge?.headers["x-device-id"]).toBe(write?.headers["x-device-id"]);
    expect(challenge?.headers["x-attestation"]).toBeUndefined();
    expect(register?.headers["x-attestation"]).toBeUndefined();
    expect(attestedChallenges).toEqual([CHALLENGE]);
    expect(register?.body).toBe(
      `{"keyId":"${keyIdFor(1)}","attestation":"${base64(`attestation of ${keyIdFor(1)}`)}","challenge":"${CHALLENGE}"}`,
    );
    expect(signedClientData).toEqual([
      `mymeetingapp write v1\nPOST\n/api/v1/tags\n1791201600000\n{"meetingId":"${MEETING_ID}","tags":["quiet"]}`,
    ]);
    expect(write?.headers["x-attestation"]).toBe(
      `appattest.v1.${keyIdFor(1)}.1791201600000.${base64("assertion 1")}`,
    );
  });

  it("keeps the key's id in the Keychain, on this phone only, and signs later writes with it", async () => {
    await tagIt();
    await editTags(MEETING_ID, ["lively"]);
    expect(keychainItem("attest-key-id")).toEqual({
      value: keyIdFor(1),
      options: { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    });
    expect(sent().slice(3)).toEqual([`PUT /api/v1/tags/${MEETING_ID}`]);
    expect(proofOf(3)?.startsWith(`appattest.v1.${keyIdFor(1)}.`)).toBe(true);
  });

  it("registers a new key when the saved one no longer works, as after a reinstall", async () => {
    setKeychainItem("attest-key-id", keyIdFor(9));
    makeKeyStale(keyIdFor(9));
    expect(await tagIt()).toEqual(ANSWER);
    expect(sent()).toEqual([...REGISTERING, "POST /api/v1/tags"]);
    expect(keychainItem("attest-key-id")?.value).toBe(keyIdFor(1));
  });

  it("replaces a key the server no longer holds, once, and sends the write again", async () => {
    setKeychainItem("attest-key-id", keyIdFor(9));
    api.replyOnce("/api/v1/tags", REFUSED, 401, "POST");
    expect(await tagIt()).toEqual(ANSWER);
    expect(sent()).toEqual(["POST /api/v1/tags", ...REGISTERING, "POST /api/v1/tags"]);
    expect(proofOf(3)?.startsWith(`appattest.v1.${keyIdFor(1)}.`)).toBe(true);
  });

  it("shows the server's words when the new key is refused too, and tries no more", async () => {
    setKeychainItem("attest-key-id", keyIdFor(9));
    api.reply("/api/v1/tags", REFUSED, 401, "POST");
    await expect(tagIt()).rejects.toMatchObject(REFUSED.error);
    expect(sent().filter((request) => request === "POST /api/v1/tags")).toHaveLength(2);
  });

  it("registers again after Delete all my tags, whose server deleted the key", async () => {
    await tagIt();
    await deleteMine();
    expect(keychainItem("attest-key-id")).toBeUndefined();
    await suggestTag("Candlelight");
    expect(sent().slice(-3)).toEqual([...REGISTERING, "POST /api/v1/suggestions"]);
  });

  it("sends the write without a proof when Apple can't attest right now, and saves no key", async () => {
    setAttestTrouble("unavailable");
    expect(await tagIt()).toEqual(ANSWER);
    expect(sent()).toEqual(["POST /api/v1/attest/challenge", "POST /api/v1/tags"]);
    expect(proofOf(1)).toBeUndefined();
    expect(keychainItem("attest-key-id")).toBeUndefined();
  });

  it("sends one write at a time, so its assertions arrive in order", async () => {
    setKeychainItem("attest-key-id", keyIdFor(1));
    const answer = api.answerLater("/api/v1/tags");
    const writes = Promise.all([tagIt(), suggestTag("Candlelight")]);
    await waitFor(() => {
      expect(sent()).toEqual(["POST /api/v1/tags"]);
    });
    const answeredAt = Date.now();
    answer(ANSWER);
    await writes;
    expect(sent()).toEqual(["POST /api/v1/tags", "POST /api/v1/suggestions"]);
    expect(api.requests[1]?.at).toBeGreaterThanOrEqual(answeredAt);
    expect(signedClientData.map((text) => text.split("\n")[2])).toEqual([
      "/api/v1/tags",
      "/api/v1/suggestions",
    ]);
  });
});

describe("where App Attest isn't offered", () => {
  it("sends a DeviceCheck token on an iPhone without it, and registers nothing", async () => {
    setIntegrity("deviceCheck");
    await tagIt();
    expect(sent()).toEqual(["POST /api/v1/tags"]);
    expect(proofOf(0)).toBe(`devicecheck.v1.${base64("device check token")}`);
  });

  it("sends the write without a proof on the simulator", async () => {
    setIntegrity("none");
    await tagIt();
    expect(sent()).toEqual(["POST /api/v1/tags"]);
    expect(proofOf(0)).toBeUndefined();
  });

  it("sends the write without a proof on Android, until Play Integrity (Phase 6b)", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    await tagIt();
    expect(sent()).toEqual(["POST /api/v1/tags"]);
    expect(proofOf(0)).toBeUndefined();
  });
});
```

Import `waitFor` from `@testing-library/react-native`. In `test/writes.test.ts`, rename "carry the three device headers, no attestation yet, and no body when there's nothing to send" to "carry the three device headers, and no proof on a phone that can't make one (the simulator), and no body when there's nothing to send".

In `test/app-shell.test.tsx`, add `entitlements: z.record(z.string(), z.string())` to `Config.ios`, and:

```ts
// Spec §6. Xcode's App Attest capability writes "development"; TestFlight and App Store builds ignore it and always
// attest in production, so only a dev build on a device uses Apple's development environment.
it("asks for App Attest", () => {
  expect(Config.parse(appConfig(CONTEXT)).ios.entitlements).toEqual({
    "com.apple.developer.devicecheck.appattest-environment": "development",
  });
});
```

Run `pnpm --filter mobile test attestation writes app-shell`. Expected: FAIL; `@modules/app-integrity` doesn't exist and nothing attests.

- [ ] **Step 2: The native module.** Create `apps/mobile/modules/app-integrity/expo-module.config.json`:

```json
{
  "platforms": ["apple"],
  "apple": { "modules": ["AppIntegrityModule"] }
}
```

Create `apps/mobile/modules/app-integrity/index.ts`:

```ts
import { requireOptionalNativeModule } from "expo";

// Spec §6, iOS only: Android's Play Integrity joins in Phase 6b, so there the module is absent (null). Keys and proofs
// are base64 strings; the shared contract checks them before anything is sent.
interface AppIntegrityModule {
  readonly isAppAttestSupported: boolean;
  readonly isDeviceCheckSupported: boolean;
  generateKey(): Promise<string>;
  attestKey(keyId: string, challenge: string): Promise<string>;
  generateAssertion(keyId: string, clientData: string): Promise<string>;
  deviceCheckToken(): Promise<string>;
}

export default requireOptionalNativeModule<AppIntegrityModule>("AppIntegrity");
```

Create `apps/mobile/modules/app-integrity/ios/AppIntegrity.podspec`:

```ruby
Pod::Spec.new do |s|
  s.name           = 'AppIntegrity'
  s.version        = '1.0.0'
  s.summary        = 'App Attest and DeviceCheck for app checks'
  s.description    = 'Makes and attests an App Attest key, signs requests with it, and makes DeviceCheck tokens.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'DeviceCheck', 'CryptoKit'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
```

Create `apps/mobile/modules/app-integrity/ios/AppIntegrityModule.swift`:

```swift
import CryptoKit
import DeviceCheck
import ExpoModulesCore

// Spec §6: App Attest on iPhones that have it, DeviceCheck on the few that don't. The private key is made in, and never
// leaves, the Secure Enclave; JavaScript sees only the key's id and the proofs. Each challenge or request text is
// hashed here with SHA-256 into the client data hash Apple signs, exactly as the server recomputes it.
public class AppIntegrityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppIntegrity")

    Constant("isAppAttestSupported") { DCAppAttestService.shared.isSupported }
    Constant("isDeviceCheckSupported") { DCDevice.current.isSupported }

    AsyncFunction("generateKey") { () async throws -> String in
      try await apple { try await DCAppAttestService.shared.generateKey() }
    }

    AsyncFunction("attestKey") { (keyId: String, challenge: String) async throws -> String in
      try await apple {
        try await DCAppAttestService.shared.attestKey(keyId, clientDataHash: hashed(challenge)).base64EncodedString()
      }
    }

    AsyncFunction("generateAssertion") { (keyId: String, clientData: String) async throws -> String in
      try await apple {
        try await DCAppAttestService.shared.generateAssertion(keyId, clientDataHash: hashed(clientData))
          .base64EncodedString()
      }
    }

    AsyncFunction("deviceCheckToken") { () async throws -> String in
      try await apple { try await DCDevice.current.generateToken().base64EncodedString() }
    }
  }
}

private func hashed(_ text: String) -> Data {
  Data(SHA256.hash(data: Data(text.utf8)))
}

// A key the system no longer holds (after a reinstall, a restore or a migration) must be replaced, so it gets its own
// code; any other failure is just a failure, and the write goes without a proof.
private func apple<T>(_ work: () async throws -> T) async throws -> T {
  do {
    return try await work()
  } catch let error as DCError where error.code == .invalidKey {
    throw AppIntegrityException("ERR_INVALID_KEY")
  } catch {
    throw AppIntegrityException("ERR_APP_INTEGRITY")
  }
}

internal final class AppIntegrityException: Exception {
  init(_ code: String) {
    super.init(name: "AppIntegrityException", description: "[AppIntegrity] \(code)", code: code)
  }
}
```

In `app.config.ts`'s `ios`, after `infoPlist`:

```ts
    // Spec §6: App Attest. "development" is what Xcode's capability writes; TestFlight and App Store builds ignore it and
    // always attest in production. EAS turns the capability on for the App ID from this entitlement.
    entitlements: { "com.apple.developer.devicecheck.appattest-environment": "development" },
```

- [ ] **Step 3: The device layer.** Create `apps/mobile/src/device/app-integrity.ts`:

```ts
import { AttestRegisterRequest } from "@mymeetingapp/shared";
import AppIntegrity from "@modules/app-integrity";
import * as SecureStore from "expo-secure-store";

import { appPlatform } from "@/config/app-version";
import { withinTimeLimit } from "@/location/time-limit";

// Spec §6: the App Attest key's id, kept like the phone's ID: in the Keychain, on this phone only, while unlocked. The
// key itself never leaves the Secure Enclave. A reinstall keeps the id but not the key, so assertions then fail and a
// new key is made.
const KEY = "attest-key-id";
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type IntegritySupport = "appAttest" | "deviceCheck" | "none";

// The saved key is no longer on this phone (a reinstall, a restore, a migration): it has to be replaced.
export class StaleAttestKey extends Error {
  constructor() {
    super("This phone no longer has its App Attest key");
    this.name = "StaleAttestKey";
  }
}

// Which proof this phone can make: App Attest on almost every iPhone, DeviceCheck where App Attest isn't offered (an
// iPhone app on a Mac), none on a simulator or on Android (Play Integrity is Phase 6b).
export function integritySupport(): IntegritySupport {
  if (appPlatform() !== "ios" || AppIntegrity === null) return "none";
  if (AppIntegrity.isAppAttestSupported) return "appAttest";
  return AppIntegrity.isDeviceCheckSupported ? "deviceCheck" : "none";
}

function integrity(): NonNullable<typeof AppIntegrity> {
  if (AppIntegrity === null) throw new Error("App checks aren't available on this phone");
  return AppIntegrity;
}

export async function savedAttestKey(): Promise<string | null> {
  const saved = AttestRegisterRequest.shape.keyId.safeParse(await SecureStore.getItemAsync(KEY, OPTIONS));
  return saved.success ? saved.data : null;
}

export const rememberAttestKey = (keyId: string) => SecureStore.setItemAsync(KEY, keyId, OPTIONS);
export const forgetAttestKey = () => SecureStore.deleteItemAsync(KEY, OPTIONS);

// Apple's calls can wait on its servers, so each is bounded like a location call.
export const newAttestKey = () => withinTimeLimit(integrity().generateKey());
export const attestKey = (keyId: string, challenge: string) =>
  withinTimeLimit(integrity().attestKey(keyId, challenge));
export const deviceCheckToken = () => withinTimeLimit(integrity().deviceCheckToken());

export async function assertion(keyId: string, clientData: string): Promise<string> {
  try {
    return await withinTimeLimit(integrity().generateAssertion(keyId, clientData));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_INVALID_KEY") {
      throw new StaleAttestKey();
    }
    throw error;
  }
}
```

- [ ] **Step 4: `sendWrite`.** In `src/api/client.ts`, import `appAttestHeader`, `assertionClientData`, `AttestChallengeResponse`, `AttestRegisterRequest`, `AttestRegisterResponse`, `DEVICE_HEADERS`, `deviceCheckHeader` and `parseAttestation` from shared, and the device functions from `@/device/app-integrity`. Replace everything from `type WriteMethod` down with:

```ts
type WriteMethod = "POST" | "PUT" | "DELETE";

async function deviceHeaders(): Promise<Record<string, string>> {
  return { Accept: "application/json", ...(await writeHeaders()) };
}

// Spec §6: a new App Attest key. The server gives a challenge, Apple attests the key over it, and the server checks
// that. The key's id is saved only once the server holds it.
async function registerAttestKey(): Promise<string> {
  const keyId = await newAttestKey();
  const headers = await deviceHeaders();
  const { challenge } = await request(AttestChallengeResponse, "/api/v1/attest/challenge", {
    method: "POST",
    headers,
  });
  const registration = AttestRegisterRequest.parse({
    keyId,
    attestation: await attestKey(keyId, challenge),
    challenge,
  });
  await request(AttestRegisterResponse, "/api/v1/attest/register", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(registration),
  });
  await rememberAttestKey(keyId);
  return keyId;
}

async function signed(keyId: string, clientData: string, timestamp: number): Promise<string> {
  return appAttestHeader(keyId, timestamp, await assertion(keyId, clientData));
}

// Spec §6: the proof for one write. Whatever stops the phone making one (a simulator, Apple out of reach, a refused
// registration) sends the write without it, and the server decides whether it needs one.
async function attestation(method: WriteMethod, path: string, body: string): Promise<string | undefined> {
  try {
    const support = integritySupport();
    if (support === "none") return undefined;
    if (support === "deviceCheck") return deviceCheckHeader(await deviceCheckToken());
    const timestamp = Date.now();
    const clientData = assertionClientData({ method, path, timestamp, body });
    const saved = await savedAttestKey();
    if (saved !== null) {
      try {
        return await signed(saved, clientData, timestamp);
      } catch (error) {
        if (!(error instanceof StaleAttestKey)) throw error;
        await forgetAttestKey();
      }
    }
    return await signed(await registerAttestKey(), clientData, timestamp);
  } catch {
    return undefined;
  }
}

async function attempt<S extends z.ZodType>(
  schema: S,
  method: WriteMethod,
  path: string,
  body: string | undefined,
  proof: string | undefined,
): Promise<z.output<S>> {
  const headers = await deviceHeaders();
  if (proof !== undefined) headers[DEVICE_HEADERS.attestation] = proof;
  if (body === undefined) return request(schema, path, { method, headers });
  return request(schema, path, { method, headers: { ...headers, "Content-Type": "application/json" }, body });
}

let writing: Promise<unknown> = Promise.resolve();

// One write at a time, so the server sees assertion counters in the order they were made.
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = writing.then(task, task);
  writing = run.catch(() => undefined);
  return run;
}

// Writes carry the phone's device headers and its proof (spec §6, §7) and, like reads, no cookies. A write with
// nothing to say (a deletion) sends no body and no Content-Type. A refused App Attest key (gone from the server after
// Delete all my tags) is replaced and the write sent once more: nothing was written, as the check runs first.
export function sendWrite<S extends z.ZodType>(
  schema: S,
  method: WriteMethod,
  path: string,
  body?: unknown,
): Promise<z.output<S>> {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return oneAtATime(async () => {
    const proof = await attestation(method, path, text ?? "");
    try {
      return await attempt(schema, method, path, text, proof);
    } catch (error) {
      const keyRefused =
        error instanceof ApiError &&
        error.code === "attestation_failed" &&
        proof !== undefined &&
        parseAttestation(proof)?.kind === "appAttest";
      if (!keyRefused) throw error;
      await forgetAttestKey();
      return attempt(schema, method, path, text, await attestation(method, path, text ?? ""));
    }
  });
}
```

In `src/api/writes.ts`:

```ts
// Spec §7: every tag, suggestion still linked, rate-limit, audit and attestation row for this phone. It has no body,
// and works below the minimum version and with tagging switched off. The server deleted this phone's App Attest key
// too, so the phone forgets it, best effort: a key it couldn't forget is replaced on the next write's retry.
export const deleteMine = async () => {
  const deleted = await sendWrite(DeleteMineResponse, "POST", "/api/v1/tags/delete-mine");
  await forgetAttestKey().catch(() => undefined);
  return deleted;
};
```

importing `forgetAttestKey` from `@/device/app-integrity`.

- [ ] **Step 5: Lint.** In `eslint.config.js`, add to `DEVICE_ID_IMPORTS`:

```js
  {
    name: "@modules/app-integrity",
    message: "Use sendWrite() from @/api/client; it attests writes through @/device/app-integrity.",
  },
```

- [ ] **Step 6: Run.** `pnpm --filter mobile test`. Expected: PASS, the whole suite: every other test runs on the fake's default "none", as before.

- [ ] **Step 7: Build it.** `cd apps/mobile && EXPO_NO_TELEMETRY=1 npx expo run:ios --port 8082`. Expected: the build compiles `AppIntegrityModule.swift` and the app opens in the simulator. App Attest isn't supported there, so a tag goes without a proof (the server's checks are off locally).

- [ ] **Step 8: Standards and commit.** In `docs/standards.md`:
  - **"The app's network calls":** append "`sendWrite` sends one write at a time, attaches `X-Attestation` (an App Attest assertion over `assertionClientData`, or a DeviceCheck token), registers a key through `/attest/challenge` and `/attest/register` when it has none, and replaces a key the server refuses, once. A phone that can't make a proof sends the write without one."
  - **"The phone's ID":** after "`writeHeaders()` from `@/device/write-headers`", add "and, for the App Attest key's id, `@/device/app-integrity` (the only importer of `@modules/app-integrity`)". Change "the only reader" to "the only readers", and add `@modules/app-integrity` to the lint list.
  - **"Location and places in the app":** add "(Apple's App Attest and DeviceCheck calls in `@/device/app-integrity` use the same bound)" after the `withinTimeLimit` sentence.

  Then `pnpm check`, and:

```bash
git add apps/mobile eslint.config.js docs/standards.md
git commit -m "feat(mobile): attest every write with App Attest, or DeviceCheck where it isn't offered"
```

---

### Task 9: The network audit requires `X-Attestation` on writes

Until now the audit flagged any `X-Attestation` "isn't switched on yet" (finding 14). Now:

- each of the five writes must carry the header, and its value must be exactly one of the two shapes `parseAttestation` reads;
- the app check's own two requests join the allowed list. Both carry the device headers and no proof. The challenge has no body, and the registration's body is byte-exact.

Because a simulator can't attest, the Phase 6 audit runs on the owner's iPhone (Task 14).

**Files:**

- Modify: `tools/network-audit/src/audit.ts`, `tools/network-audit/src/headers.ts`, `tools/network-audit/test/audit.test.ts`, `tools/network-audit/test/headers.test.ts`, `docs/mobile.md`

**Interfaces:**

- Consumes: `parseAttestation`, `AttestRegisterRequest`, `DEVICE_HEADERS` (shared).
- Produces: `HeaderContext.attested: boolean` (the request is one of the five writes that must carry a proof). `WRITES` entries gain `attested: boolean`.

- [ ] **Step 1: Failing tests.** In `tools/network-audit/test/headers.test.ts`, give the contexts `attested`:

```ts
const GET = { method: "GET", server: SERVER, write: false, attested: false };
const POST = { method: "POST", server: SERVER, write: false, attested: false };
// PUT never reads; every PUT the app sends (tag edit) is an attested write.
const PUT = { method: "PUT", server: SERVER, write: true, attested: true };
```

Give `WRITE` in "device headers on writes (spec §7)" `attested: true`, and replace "flags X-Attestation until Phase 6 turns it on" with:

```ts
const PROOF = `appattest.v1.${"A".repeat(43)}=.1791201600000.omlzaWduYXR1cmU=`;

it("passes an App Attest proof or a DeviceCheck token on a write that carries one", () => {
  expect(headerFinding("X-Attestation", PROOF, WRITE)).toBeUndefined();
  expect(headerFinding("X-Attestation", "devicecheck.v1.AgAAAAbcdef+/==", WRITE)).toBeUndefined();
});

it.each([
  ["a value that isn't a proof", "abc"],
  ["a coordinate where the clock goes", `appattest.v1.${"A".repeat(43)}=.36.162749.abc=`],
])("flags X-Attestation with %s", (_why, value) => {
  expect(headerFinding("X-Attestation", value, WRITE)).toBe(
    "sends an unexpected value for the X-Attestation header",
  );
});

it("flags X-Attestation on the app check's own requests, which never carry one", () => {
  expect(headerFinding("X-Attestation", PROOF, { ...WRITE, attested: false })).toBe(
    "sends X-Attestation on a request that never carries one",
  );
});
```

In `tools/network-audit/test/audit.test.ts`'s `describe("writes")`:

- add `["X-Attestation", PROOF]` to `WRITE_HEADERS` (with the same `PROOF` constant);
- add `const DEVICE_ONLY = WRITE_HEADERS.filter(([name]) => name !== "X-Attestation");`;
- extend the "passes each of the app's writes" capture with the two app check requests, raising the expected `writeRequests` from 6 to 8:

```ts
          entry("POST", `https://${SERVER}/api/v1/attest/challenge`, { headers: DEVICE_ONLY }),
          entry("POST", `https://${SERVER}/api/v1/attest/register`, {
            headers: DEVICE_ONLY,
            body: `{"keyId":"${"A".repeat(43)}=","attestation":"o2NmbXQ=","challenge":"${"c".repeat(43)}"}`,
          }),
```

Add `"X-Attestation"`/`"x-attestation"` to the "fails a write missing %s" table, delete "fails X-Attestation until Phase 6 turns it on", and add:

```ts
it("fails a registration whose body isn't exactly what the app sends", () => {
  expect(
    problemsWith(
      entry("POST", `https://${SERVER}/api/v1/attest/register`, {
        headers: DEVICE_ONLY,
        body: `{"keyId":"${"A".repeat(43)}=","attestation":"o2NmbXQ=","challenge":"${"c".repeat(43)}","lat":36.16}`,
      }),
    ),
  ).toContain("write body isn't exactly what the app sends");
});

it("fails a challenge request that carries a body or a proof", () => {
  expect(
    problemsWith(
      entry("POST", `https://${SERVER}/api/v1/attest/challenge`, { headers: DEVICE_ONLY, body: '{"x":1}' }),
    ),
  ).toContain("sends a body on a write that has none");
  expect(
    problemsWith(entry("POST", `https://${SERVER}/api/v1/attest/challenge`, { headers: WRITE_HEADERS })),
  ).toContain("sends X-Attestation on a request that never carries one");
});
```

Run `pnpm --filter network-audit test`. Expected: FAIL.

- [ ] **Step 2: Implement.** In `src/headers.ts`, add to `HeaderContext`:

```ts
// Whether this write must carry X-Attestation (spec §6): the five writes do; the app check's own two requests,
// which run before the phone has a key, never do.
attested: boolean;
```

and in `headerFinding`, replace the `x-attestation` branch with:

```ts
if (lower === DEVICE_HEADERS.attestation.toLowerCase()) {
  if (!context.attested) return "sends X-Attestation on a request that never carries one";
  return parseAttestation(value) === null ? `sends an unexpected value for the ${name} header` : undefined;
}
```

(importing `parseAttestation` from shared). In `src/audit.ts`:

- `WRITES` entries gain `attested`: `true` for the five, and two new entries:

```ts
  // The app check's own requests (Phase 6): device headers, never a proof.
  { method: "POST", path: /^\/api\/v1\/attest\/challenge$/, body: null, attested: false },
  {
    method: "POST",
    path: /^\/api\/v1\/attest\/register$/,
    body: z.strictObject(AttestRegisterRequest.shape),
    attested: false,
  },
```

- `REQUIRED_DEVICE_HEADERS` stays the three. In the write branch, after checking them, add:

```ts
if (write.attested && !request.headers.some((header) => header.name.toLowerCase() === "x-attestation")) {
  flag("write without the x-attestation header");
}
```

- Pass `attested: write?.attested ?? false` into `headerFinding`'s context.
- Update the comments that say Phase 5b or "still off".

- [ ] **Step 3: Run.** `pnpm --filter network-audit test`. Expected: PASS.

- [ ] **Step 4: Docs and commit.** In `docs/mobile.md`, "Proxy audit":
  - replace the sentence "`X-Attestation` is a finding on every write until Phase 6 turns it on (\"sends X-Attestation, which isn't switched on yet\")" with: "`X-Attestation` is required on the five writes and must be exactly `appattest.v1.<44-character key id>.<13-digit clock>.<base64>` or `devicecheck.v1.<base64>` (the shared `parseAttestation`). The app check's own `POST /attest/challenge` (no body) and `POST /attest/register` (`AttestRegisterRequest`, byte-exact) carry the device headers and never a proof.";
  - add a line under it: "A simulator can't attest, so from Phase 6 the audit runs on an iPhone (Task 14 of the Phase 6 plan has the steps)."

  Then `pnpm check`, and:

```bash
git add tools/network-audit docs/mobile.md
git commit -m "feat(network-audit): require X-Attestation on writes and allow the app check's own requests"
```

---

### Task 10: The privacy manifest, the App Privacy label, the age rating and the review notes

Spec §11 asks for an iOS privacy manifest with the required-reason APIs, the App Privacy label, and the age rating questionnaire. The manifest's collected-data list _is_ the label in machine-readable form, so one test holds it to spec §11's list. The same test holds its required-reason APIs to every one the app's iOS libraries declare (Expo: static CocoaPods' manifests aren't parsed correctly, so the app declares them; finding 7).

`docs/app-store.md` holds what is typed into App Store Connect by hand: each App Privacy answer mapped to §13, the age rating answers, export compliance, content rights, the App Review notes and the release checklist.

**Files:**

- Create: `apps/mobile/test/privacy-manifest.test.ts`, `docs/app-store.md`
- Modify: `apps/mobile/app.config.ts`, `apps/mobile/package.json` (`@expo/plist` dev dependency)

**Interfaces:**

- Produces:
  - `app.config.ts` `ios.privacyManifests`: `NSPrivacyTracking: false`, `NSPrivacyTrackingDomains: []`;
  - three collected data types (CoarseLocation, DeviceID, OtherUserContent; each not linked, not tracking, App Functionality only);
  - four accessed API types (FileTimestamp `C617.1`, `0A2A.1`, `3B52.1`; UserDefaults `CA92.1`; SystemBootTime `35F9.1`; DiskSpace `E174.1`, `85F4.1`).

- [ ] **Step 1: Failing test.** `pnpm --filter mobile add -D @expo/plist@0.8.1`. Create `apps/mobile/test/privacy-manifest.test.ts`:

```ts
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import plist from "@expo/plist";
import { z } from "zod";

import appConfig from "../app.config";

const ROOT = path.join(__dirname, "..");
const CONTEXT = { projectRoot: ROOT, staticConfigPath: null, packageJsonPath: null, config: {} };
const SPEC = readFileSync(path.join(ROOT, "../../SPEC.md"), "utf8");

const AccessedApi = z.object({
  NSPrivacyAccessedAPIType: z.string(),
  NSPrivacyAccessedAPITypeReasons: z.array(z.string()),
});
const Manifest = z.object({
  NSPrivacyTracking: z.boolean(),
  NSPrivacyTrackingDomains: z.array(z.string()),
  NSPrivacyCollectedDataTypes: z.array(
    z.object({
      NSPrivacyCollectedDataType: z.string(),
      NSPrivacyCollectedDataTypeLinked: z.boolean(),
      NSPrivacyCollectedDataTypeTracking: z.boolean(),
      NSPrivacyCollectedDataTypePurposes: z.array(z.string()),
    }),
  ),
  NSPrivacyAccessedAPITypes: z.array(AccessedApi),
});
const appManifest = () =>
  Manifest.parse(
    z.object({ ios: z.object({ privacyManifests: z.unknown() }) }).parse(appConfig(CONTEXT)).ios
      .privacyManifests,
  );

// Spec §11's label names, as Apple's manifest spells each data type.
const APPLE_DATA_TYPES: Record<string, string> = {
  "Coarse Location": "NSPrivacyCollectedDataTypeCoarseLocation",
  "Device ID": "NSPrivacyCollectedDataTypeDeviceID",
  "Other User Content": "NSPrivacyCollectedDataTypeOtherUserContent",
};

// The data types listed under spec §11's "Apple App Privacy label" (each bullet is "Name (purposes)").
function specLabel(): string[] {
  const section = SPEC.slice(SPEC.indexOf("## 11. Store requirements"), SPEC.indexOf("## 12."));
  const label = section.slice(
    section.indexOf("**Apple App Privacy label:**"),
    section.indexOf("**Google Play"),
  );
  return [...label.matchAll(/^\s+- ([A-Z][A-Za-z ]+?) \(/gm)].map((match) => match[1] ?? "");
}

// Every PrivacyInfo.xcprivacy shipped by the app's own dependencies and Expo's native ones. react-native-maps' Google
// Maps bundle is left out: it's built only with Google Maps on iOS, which the app doesn't use (Apple Maps).
function libraryManifests(): string[] {
  const Dependencies = z.object({ dependencies: z.record(z.string(), z.string()) });
  const packageDirs = (dir: string, filter: (name: string) => boolean) =>
    Object.keys(
      Dependencies.parse(JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))).dependencies,
    )
      .filter(filter)
      .map((name) => realpathSync(path.join(dir, "node_modules", name)));
  const expo = realpathSync(path.join(ROOT, "node_modules/expo"));
  const expoModules = Object.keys(
    Dependencies.parse(JSON.parse(readFileSync(path.join(expo, "package.json"), "utf8"))).dependencies,
  )
    .filter((name) => name.startsWith("expo-"))
    .map((name) => realpathSync(path.join(expo, "..", name)));
  // The workspace's own packages hold no native code.
  return [...packageDirs(ROOT, (name) => !name.startsWith("@mymeetingapp/")), ...expoModules].flatMap((dir) =>
    readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith("PrivacyInfo.xcprivacy"))
      .filter((file) => !file.includes("node_modules") && !file.includes("AirGoogleMaps"))
      .map((file) => path.join(dir, file)),
  );
}

describe("the iOS privacy manifest", () => {
  it("declares exactly the data spec §11's App Privacy label lists", () => {
    expect(specLabel()).toEqual(["Coarse Location", "Device ID", "Other User Content"]);
    expect(
      appManifest()
        .NSPrivacyCollectedDataTypes.map((type) => type.NSPrivacyCollectedDataType)
        .sort(),
    ).toEqual(
      specLabel()
        .map((name) => APPLE_DATA_TYPES[name])
        .sort(),
    );
  });

  // Apple counts fraud prevention as App Functionality ("prevent fraud, implement security measures").
  it("marks every type not linked to identity, not for tracking, and used for app functionality only", () => {
    expect(SPEC).toContain("All marked not linked to identity and not used for tracking.");
    const manifest = appManifest();
    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyTrackingDomains).toEqual([]);
    for (const type of manifest.NSPrivacyCollectedDataTypes) {
      expect(type).toMatchObject({
        NSPrivacyCollectedDataTypeLinked: false,
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
      });
    }
  });

  it("declares every required-reason API the app's iOS libraries declare, with their reasons", () => {
    const files = libraryManifests();
    expect(
      files.some((file) => file.endsWith(path.join("React", "Resources", "PrivacyInfo.xcprivacy"))),
    ).toBe(true);
    const ours = new Map(
      appManifest().NSPrivacyAccessedAPITypes.map((api) => [
        api.NSPrivacyAccessedAPIType,
        api.NSPrivacyAccessedAPITypeReasons,
      ]),
    );
    for (const file of files) {
      const library = z
        .object({ NSPrivacyAccessedAPITypes: z.array(AccessedApi).optional() })
        .parse(plist.parse(readFileSync(file, "utf8")));
      for (const api of library.NSPrivacyAccessedAPITypes ?? []) {
        expect(ours.get(api.NSPrivacyAccessedAPIType), file).toEqual(
          expect.arrayContaining(api.NSPrivacyAccessedAPITypeReasons),
        );
      }
    }
  });
});
```

Run `pnpm --filter mobile test privacy-manifest`. Expected: FAIL; `ios.privacyManifests` isn't set.

- [ ] **Step 2: The manifest.** In `app.config.ts`, above the default export:

```ts
// Spec §11's App Privacy label as the manifest declares it: collected (sent and kept beyond one request), not linked to
// identity, not for tracking, for app functionality (where Apple puts fraud prevention). privacy-manifest.test.ts holds
// it to SPEC.md.
const collected = (type: string) => ({
  NSPrivacyCollectedDataType: type,
  NSPrivacyCollectedDataTypeLinked: false,
  NSPrivacyCollectedDataTypeTracking: false,
  NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
});
```

and in `ios`, after `entitlements`:

```ts
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [
        // The rounded search point (spec §11; owner decision needed 5).
        collected("NSPrivacyCollectedDataTypeCoarseLocation"),
        // The keyed hash of the phone's ID, and its App Attest key.
        collected("NSPrivacyCollectedDataTypeDeviceID"),
        // Tags and suggested words.
        collected("NSPrivacyCollectedDataTypeOtherUserContent"),
      ],
      // The required-reason APIs the app's iOS libraries use (React Native, expo-application, expo-constants,
      // expo-file-system, expo-system-ui, react-native-maps), each with the reasons their own manifests give.
      // privacy-manifest.test.ts fails when a library adds one.
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryFileTimestamp",
          NSPrivacyAccessedAPITypeReasons: ["C617.1", "0A2A.1", "3B52.1"],
        },
        { NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults", NSPrivacyAccessedAPITypeReasons: ["CA92.1"] },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategorySystemBootTime",
          NSPrivacyAccessedAPITypeReasons: ["35F9.1"],
        },
        {
          NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace",
          NSPrivacyAccessedAPITypeReasons: ["E174.1", "85F4.1"],
        },
      ],
    },
```

Run `pnpm --filter mobile test privacy-manifest app-shell`. Expected: PASS.

- [ ] **Step 3: `docs/app-store.md`.** Create it with exactly this content:

````markdown
# The App Store: what's entered by hand

The listing itself (name, subtitle, description, keywords, URLs, categories, copyright, release) lives in `apps/mobile/store.config.json` and is pushed with `eas metadata:push`. Everything here is entered in App Store Connect by the owner, because the API doesn't cover it or it holds the owner's phone number.

## App Privacy

App Store Connect → the app → App Privacy → "Get Started".

- "Do you or your third-party partners collect data from this app?" → **Yes**.
- Choose exactly these three, and nothing else:

| Data type (Apple)                     | Spec §11                                        | §13 rows it covers                                                                                           | Usage                                                                                        | Linked to the user? | Tracking? |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------- | --------- |
| Location → **Coarse Location**        | Coarse Location (app functionality)             | Search request (rounded to ~1 km, used for one query, not stored)                                            | App Functionality                                                                            | No                  | No        |
| Identifiers → **Device ID**           | Device ID (app functionality, fraud prevention) | `devices` (hash, App Attest key), `rate_limits`, `tag_audit` (7 days), `suggestions` (device link ≤ 30 days) | App Functionality (Apple's definition includes "prevent fraud, implement security measures") | No                  | No        |
| User Content → **Other User Content** | Other User Content (tags, suggestions)          | `tag_submissions`, `suggestions`, `ai_decisions`                                                             | App Functionality                                                                            | No                  | No        |

Not declared, and why:

- **Precise Location:** the exact position stays on the phone (§13); the attendance check sends only yes or no.
- **Health & Fitness:** the sobriety date stays on the phone.
- **Contact Info:** support email is sent from the person's own mail app, outside this app.
- **Crash Data, Performance Data, Product Interaction:** none collected; no analytics SDK.
- **IP address:** not a data type of its own. Vercel's request logs aren't used to derive location.

Coarse Location is declared because spec §11 lists it, though by Apple's definition (data "immediately discarded after servicing the request") it isn't collected (owner decision needed 5).

The privacy manifest's `NSPrivacyCollectedDataTypes` in `apps/mobile/app.config.ts` declares the same three, and `privacy-manifest.test.ts` holds them to SPEC.md.

## Age rating

App Store Connect → App Information → Age Rating → Edit. Answer:

| Question                                                                                                                 | Answer                                 | Why                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cartoon or Fantasy Violence, Realistic Violence, Prolonged Graphic or Sadistic Realistic Violence, Guns or Other Weapons | None                                   |                                                                                                                                                              |
| Profanity or Crude Humor, Horror/Fear Themes                                                                             | None                                   |                                                                                                                                                              |
| **Alcohol, Tobacco, or Drug Use or References**                                                                          | **Infrequent**                         | Spec §11: "alcohol references apply". AA meetings and recovery are named; nothing encourages drinking (guideline 1.4.3)                                      |
| Mature or Suggestive Themes, Sexual Content or Nudity, Graphic Sexual Content and Nudity                                 | None                                   |                                                                                                                                                              |
| **Medical or Treatment Information**                                                                                     | **Infrequent**                         | The Help screen gives the SAMHSA National Helpline (treatment referral) and 988                                                                              |
| **Health or Wellness Topics**                                                                                            | **Yes**                                | Sobriety counter, recovery meetings                                                                                                                          |
| Unrestricted Web Access                                                                                                  | No                                     | Links open Safari, Maps or the phone app; there is no in-app browser                                                                                         |
| User-Generated Content                                                                                                   | No                                     | Tags come from a fixed list of 26 words; suggested words are screened and reviewed before anyone else sees them; there is no free text, profile or messaging |
| Social Media, Messaging and Chat, Advertising, Age Assurance, Parental Controls                                          | No                                     |                                                                                                                                                              |
| Gambling, Loot Boxes                                                                                                     | No; Simulated Gambling, Contests: None |                                                                                                                                                              |

Expected rating: **13+** (Infrequent alcohol references set 13+; nothing sets 16+).

## Export compliance

Already answered in the build: `ITSAppUsesNonExemptEncryption` is false (`app.config.ts`, `usesNonExemptEncryption: false`). The app uses only Apple's own encryption (HTTPS, the Keychain, App Attest), which is exempt. App Store Connect asks nothing.

## Content rights

App Information → Content Rights: "Does your app contain, show, or access third-party content?" → **Yes**, and "I have the necessary rights". Meeting listings are public data published by AA service entities in the open Meeting Guide format, used under the good-citizen rules of spec §4. The §16 legal review confirms this wording.

## Pricing and availability

- Price: Free.
- Availability: the United States only (the meeting data covers the US).
- "Make this app available on Mac": off. Apple Vision Pro: off. The app is untested there, and Macs don't offer App Attest.

## App Review

App Store Connect → the version → App Review Information.

- **Sign-in required:** No.
- **Contact:** the owner's name, phone and email (`admin@goodersoftwarellc.com`), typed by hand.
- **Notes** (paste exactly):

```
Thank you for reviewing mymeetingapp.

No sign-in: the app has no accounts, so there is no demo account. Everything works from the first launch.

Finding meetings: type a place such as "Nashville, TN" in the search box, or tap "Use my location". The app never asks for location when it opens.

How the app uses location:
- Nearby meetings: the phone rounds its location to about 1 km (two decimal places) and sends only that rounded point to our server, in the body of the search request. The server uses it for that one search and doesn't keep it.
- The attendance check: when someone opens a meeting during its time, or taps the check while adding tags, the app compares the phone's position with the meeting's address on the phone itself, and sends only a yes or no ("near the meeting") with the tags. The exact location never leaves the phone. It runs only while the app is open and only after location has been allowed, never in the background. If only approximate location is allowed, iOS asks once for temporary precise location, with our explanation.

No accounts, by design: the app makes a random ID, kept in the iPhone's Keychain, and sends it only when adding, changing or removing tags or suggesting a tag. Our server stores only a keyed hash of it. The app uses App Attest (DeviceCheck on an iPhone without it) so that only the real app can add tags. The sobriety date, saved meetings and the list of tagged meetings never leave the phone.

Trying tags: tags can be added from a meeting's start until 36 hours after it, by people who went. To try it, open Filters, choose Morning under Time, and open a meeting that started earlier today. Choose "Tag this meeting", pick a few words, and choose "Send my tags". Please then choose "Remove my tags", so test tags don't stay on a real meeting. The Me tab's "Delete all my tags" removes everything this phone added.

User content: tags are chosen from a fixed list of 26 neutral words. People can suggest a new word; we screen and review each suggestion before anyone else sees it. There is no free text, profile, messaging or rating.

Health and safety: this is a meeting finder, not a medical or treatment app, and it gives no medical advice. Every screen has a Help button with the 988 Suicide & Crisis Lifeline and the SAMHSA National Helpline. mymeetingapp is not affiliated with or endorsed by Alcoholics Anonymous or A.A. World Services; meeting listings come from public lists that local AA offices publish in the open Meeting Guide format.

Publisher: Gooder Software LLC. Contact: admin@goodersoftwarellc.com.
```

## Release checklist

Phase 6 plan Tasks 15 and 16 run this. Each line is checked before "Submit for Review", then before "Release This Version".

- [ ] Production: `REQUIRE_ATTESTATION=on`, the Apple variables set, the DeviceCheck credential check answered `attestation_failed` (not `server_error`).
- [ ] Production `/api/v1/config` sets no minimum version above 1.0.0; feeds healthy on `/metrics`.
- [ ] No Vercel Firewall rules (O5: not done, by owner decision 2026-10-04); the site-wide backstops in `docs/deploy.md` cover `/api/v1/attest/` and `/metrics`.
- [ ] Neon's production restore window is recorded and is 30 days or less.
- [ ] The §16 legal review is done and "Draft, pending legal review." is gone (owner decision needed 4).
- [ ] The production build is in no tester group but "Release check"; the owner searched with it and saw `POST /api/v1/meetings/search` in production's logs.
- [ ] The production `.ipa` holds the privacy manifest above, the App Attest entitlement, and no Always-location or background key.
- [ ] `eas metadata:push` succeeded; screenshots (6.9", 5 images) uploaded; App Privacy, age rating, content rights, pricing and availability entered as above.
- [ ] Version release: "Manually release this version".
- [ ] Before releasing: the conversion is finished and the seller shows Gooder Software LLC (owner decision needed 1).
````

- [ ] **Step 4: Commit.** `pnpm check`, then:

```bash
git add apps/mobile docs/app-store.md
git commit -m "feat(mobile): privacy manifest from spec §11, and the App Store answers entered by hand"
```

---

### Task 11: The store build's profile, the team, and the listing

The production profile must submit to the same App Store Connect app and team as TestFlight. That team is what App Attest's App ID and `APPLE_TEAM_ID` name. The listing becomes a versioned file that EAS Metadata pushes, with a test for Apple's limits and spec §11's rules. The app's version becomes 1.0.0.

**Files:**

- Create: `apps/mobile/store.config.json`, `apps/mobile/test/store-listing.test.ts`
- Modify: `apps/mobile/eas.json`, `apps/mobile/app.config.ts`, `apps/mobile/test/eas-profiles.test.ts`, `apps/mobile/test/app-shell.test.tsx`

**Interfaces:**

- Produces:
  - `eas.json`:
    - `submit.testflight.ios = { ascAppId: "6817873804", appleTeamId: "PVCZBLDJ73" }`;
    - `submit.production.ios = { ascAppId: "6817873804", appleTeamId: "PVCZBLDJ73", metadataPath: "./store.config.json" }`.
  - `app.config.ts`: `ios.appleTeamId: "PVCZBLDJ73"` and `version: "1.0.0"`.
  - `store.config.json` (EAS Metadata, `configVersion: 0`).

- [ ] **Step 1: Failing profile and config tests.** In `apps/mobile/test/eas-profiles.test.ts`, widen `EasJson.submit` to `z.object({ ios: z.object({ ascAppId: z.string(), appleTeamId: z.string(), metadataPath: z.string().optional() }) })`. Replace "submits TestFlight builds to the App Store Connect app EAS created on the first submit" with:

```ts
// One app record and one team for both: TestFlight builds and the store build are builds of the same app
// (finding: no transfer and no new record; owner decision 1). The team is the App ID prefix App Attest checks.
it("submits TestFlight and store builds to the same App Store Connect app, on team PVCZBLDJ73", () => {
  const { submit } = easJson();
  expect(submit.testflight?.ios).toEqual({ ascAppId: "6817873804", appleTeamId: "PVCZBLDJ73" });
  expect(submit.production?.ios).toEqual({
    ascAppId: "6817873804",
    appleTeamId: "PVCZBLDJ73",
    metadataPath: "./store.config.json",
  });
});
```

In `test/app-shell.test.tsx`, add `appleTeamId: z.string()` to `Config.ios`, and:

```ts
// APPLE_TEAM_ID on the server and appleTeamId in eas.json name the same team: App Attest's App ID is team.bundle.
it("builds for the team the server's App Attest checks name", () => {
  expect(Config.parse(appConfig(CONTEXT)).ios.appleTeamId).toBe("PVCZBLDJ73");
});
```

Run `pnpm --filter mobile test eas-profiles app-shell`. Expected: FAIL.

- [ ] **Step 2: The profiles.** In `apps/mobile/eas.json`, replace `submit` with:

```json
  "submit": {
    "testflight": {
      "ios": { "ascAppId": "6817873804", "appleTeamId": "PVCZBLDJ73" }
    },
    "production": {
      "ios": { "ascAppId": "6817873804", "appleTeamId": "PVCZBLDJ73", "metadataPath": "./store.config.json" }
    }
  }
```

In `app.config.ts`, set `version: "1.0.0"`, and in `ios` add `appleTeamId: "PVCZBLDJ73",` after `bundleIdentifier`, with the comment "Gooder Software LLC's team (converted from the owner's individual membership): the App ID prefix App Attest checks, and APPLE_TEAM_ID on the server." Run the two tests again. Expected: PASS.

- [ ] **Step 3: See what EAS Metadata reads today.** From `apps/mobile`, run `pnpm dlx eas-cli@24.8.0 metadata:pull`. It writes the current App Store Connect values into `store.config.json`, using the App Store Connect API key EAS already holds; if it asks for an Apple ID, the owner runs it.
  - Read the file: it shows the schema EAS 24.8.0 actually writes.
  - If it holds an `advisory` block with fields for Apple's 2025 questions (`healthOrWellnessTopics`, `medicalOrTreatmentInformation`), copy that block into Step 5's file with `docs/app-store.md`'s age rating answers, and note in `docs/app-store.md` that the age rating is now pushed.
  - Otherwise the age rating stays a hand entry (decision 12).

- [ ] **Step 4: Failing listing test.** Create `apps/mobile/test/store-listing.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

import { BRAND } from "@mymeetingapp/shared";
import { z } from "zod";

const read = (file: string): unknown => JSON.parse(readFileSync(path.join(__dirname, "..", file), "utf8"));

const Listing = z.object({
  configVersion: z.literal(0),
  apple: z.object({
    copyright: z.string(),
    categories: z.array(z.string()),
    release: z.object({ automaticRelease: z.boolean() }),
    info: z.object({
      "en-US": z.object({
        title: z.string(),
        subtitle: z.string(),
        promoText: z.string(),
        description: z.string(),
        keywords: z.array(z.string()),
        marketingUrl: z.string(),
        supportUrl: z.string(),
        privacyPolicyUrl: z.string(),
      }),
    }),
  }),
});
const listing = () => Listing.parse(read("store.config.json")).apple;
const english = () => listing().info["en-US"];
// The site the store build talks to (eas.json's production profile): the listing links the same pages the app's Me
// tab opens there.
const productionSite = () =>
  z
    .object({
      build: z.object({ production: z.object({ env: z.object({ EXPO_PUBLIC_SERVER_URL: z.string() }) }) }),
    })
    .parse(read("eas.json")).build.production.env.EXPO_PUBLIC_SERVER_URL;

describe("the App Store listing", () => {
  it("fits App Store Connect's limits", () => {
    const info = english();
    expect(info.title.length).toBeLessThanOrEqual(30);
    expect(info.subtitle.length).toBeLessThanOrEqual(30);
    expect(info.promoText.length).toBeLessThanOrEqual(170);
    expect(info.description.length).toBeLessThanOrEqual(4000);
    expect(info.keywords.join(",").length).toBeLessThanOrEqual(100);
  });

  it("starts the name with the app's name and keeps 'AA' out of it (spec §11)", () => {
    expect(english().title.startsWith(BRAND.appName)).toBe(true);
    expect(english().title).not.toMatch(/\bAA\b/i);
  });

  it("carries spec §11's keywords", () => {
    expect(english().keywords).toEqual(
      expect.arrayContaining(["aa meetings", "meeting finder", "sobriety counter"]),
    );
  });

  it("links the privacy policy and support pages on the site the store build uses (spec §11)", () => {
    const site = productionSite();
    expect(english()).toMatchObject({
      marketingUrl: site,
      supportUrl: `${site}/support`,
      privacyPolicyUrl: `${site}/privacy`,
    });
  });

  it("says it isn't AA's, isn't medical advice, and where help is", () => {
    const { description } = english();
    expect(description).toContain(
      "not affiliated with or endorsed by Alcoholics Anonymous or A.A. World Services, Inc.",
    );
    expect(description).toContain("The app isn't medical advice.");
    expect(description).toContain("the 988 Suicide & Crisis Lifeline and the SAMHSA National Helpline");
  });

  it("names the publisher and is released by hand, after the seller check (owner decision needed 1)", () => {
    expect(listing().copyright).toBe(`2026 ${BRAND.publisher}`);
    expect(listing().release).toEqual({ automaticRelease: false });
  });
});
```

Run `pnpm --filter mobile test store-listing`. Expected: FAIL (Step 3's pulled file doesn't match yet).

- [ ] **Step 5: The listing.** Replace `apps/mobile/store.config.json` with the following. Then make two changes if needed:
  - use the name the owner settled in Task 1 Step 4 (Owner decision needed 2), and the subtitle Owner decision needed 3 confirms;
  - add Step 3's `advisory` block, if any.

  This is the copy in plain words; the description reads, top to bottom, as the website does.

```json
{
  "configVersion": 0,
  "apple": {
    "copyright": "2026 Gooder Software LLC",
    "categories": ["LIFESTYLE", "HEALTH_AND_FITNESS"],
    "release": {
      "automaticRelease": false
    },
    "info": {
      "en-US": {
        "title": "My Meeting App: Meeting Finder",
        "subtitle": "Recovery meetings near you",
        "promoText": "Free, with no account, no ads and no tracking. See how people who go describe each meeting, in a few plain words.",
        "description": "Find an AA meeting that fits, described by the people who go.\n\nmymeetingapp lists in-person, hybrid and online AA meetings across the United States, from the meeting lists that local AA offices publish. Search a city or zip code, or let the app use your location to sort the meetings near you. The list starts with what's on today, from now on, and you can filter by day, time, meeting type and tags.\n\nDescriptions, not ratings\nAfter a meeting, people who went can pick up to six words from a fixed list, like \"Welcoming\", \"Step study\" or \"Easy parking\". Each meeting shows how many people chose each word. There are no stars, scores or written reviews, and tags never describe people.\n\nPrivate by design\n- No account. The app never asks for your name, email or phone number.\n- Your exact location stays on your phone. A search sends only a point rounded to about 1 km.\n- Your sobriety date, saved meetings and the list of meetings you've tagged stay on your phone.\n- No ads, no tracking and no analytics.\n\nAlso in the app\n- Online meetings happening now.\n- Directions in Apple Maps.\n- A sobriety counter with milestones.\n- Saved meetings that work offline.\n- Help at any time: the 988 Suicide & Crisis Lifeline and the SAMHSA National Helpline.\n\nmymeetingapp is not affiliated with or endorsed by Alcoholics Anonymous or A.A. World Services, Inc. Meeting listings come from local AA service offices and may be out of date. The app isn't medical advice.",
        "keywords": [
          "aa meetings",
          "meeting finder",
          "sobriety counter",
          "sober",
          "recovery",
          "12 step",
          "online meetings",
          "near me",
          "newcomer"
        ],
        "marketingUrl": "https://mymeetingapp.vercel.app",
        "supportUrl": "https://mymeetingapp.vercel.app/support",
        "privacyPolicyUrl": "https://mymeetingapp.vercel.app/privacy"
      }
    }
  }
}
```

Run `pnpm exec prettier --write apps/mobile/store.config.json`, then `pnpm --filter mobile test store-listing` (expected: PASS), then `cd apps/mobile && pnpm dlx eas-cli@24.8.0 metadata:lint` (expected: no errors).

- [ ] **Step 6: Commit.** `pnpm check`, then:

```bash
git add apps/mobile/eas.json apps/mobile/app.config.ts apps/mobile/store.config.json apps/mobile/test
git commit -m "chore(mobile): store profile and team pinned, the App Store listing, version 1.0.0"
```

---

### Task 12: Clearer feed errors — a bot check isn't a restriction

Evidence from 2026-10-02, probed from a Vercel Sandbox in iad1 with Node 22 `fetch` and our real User-Agent:

- **Cloudflare challenges:** Houston, VT District 11, San Luis Obispo, Muscle Shoals, Tri-County MO, Western Kentucky and Nature Coast FL answer `403 text/html` with Cloudflare's "Just a moment..." page. curl from the same box gets 200 JSON.
- **Incapsula:** Baton Rouge answers `200 text/html` with an Incapsula page (`_Incapsula_Resource`).
- **TSML's own restriction:** Western Colorado (`aa-westerncolorado.com`, `coaadistrict14.org`) answers `403 application/json`, 93 bytes. Re-recorded on 2026-10-02 for this plan with one request, using our User-Agent:

  ```text
  {"code":"feed_restricted","message":"This meeting list is restricted.","data":{"status":403}}
  ```

Today `fetchFeed` calls every 401/403 "restricted (HTTP 403)" and every non-JSON body "not valid JSON", so /metrics can't tell an intergroup that restricted its feed from a bot wall in front of an open one. The fixes differ: contact the intergroup, or ask the site to allow our User-Agent.

One classifier in `packages/feed-kit` (both the sync and the discovery tool use `politeFetch` from there) names the problem. The sync writes its words to `feeds.last_error`. Discovery records a new `feed_type`, `bot_blocked`, and lists those sites under their own heading in `coverage.md`.

**Hard constraint: never try to get past a bot check.** Spec §4: "a descriptive User-Agent with the contact email … Never hammer a site with retries."

- No browser or curl User-Agent, no TLS-fingerprint or header imitation, no retry meant to slip through, no solving a challenge.
- A bot-checked feed is recorded and reported, and asked for again only on its normal schedule (a failed feed is retried after a day), with the same honest request.
- The task's tests pin that one request goes out, with our User-Agent, and no second.

**Tests use recorded shapes only, never live sites.** The fixtures are:

- the TSML 403 body above;
- a 200 HTML page;
- the identifying parts of the Cloudflare and Incapsula challenge pages, trimmed, with their ray and incident IDs zeroed.

**Files:**

- Create:
  - `packages/feed-kit/src/feed-problem.ts`, `packages/feed-kit/test/feed-problem.test.ts`
  - `packages/feed-kit/test/fixtures/cloudflare-challenge.html`, `incapsula-challenge.html`, `tsml-restricted.json`, `plain-page.html`
- Modify:
  - `packages/feed-kit/src/index.ts`, `packages/feed-kit/src/registry.ts` (`FEED_TYPES`)
  - `apps/web/src/server/feeds/fetch-feed.ts`, `apps/web/test/fetch-feed.test.ts`, `apps/web/test/run-sync.test.ts`
  - `tools/feed-discovery/src/detect.ts`, `tools/feed-discovery/src/report.ts`, `tools/feed-discovery/test/detect.test.ts`, `tools/feed-discovery/test/report.test.ts`
  - `docs/standards.md`, `SPEC.md` §4

**Interfaces:**

- Produces (from `@mymeetingapp/feed-kit`):
  - `type BotCheck = "Cloudflare" | "Incapsula"`;
  - `type FeedProblem = { kind: "bot_check"; by: BotCheck } | { kind: "restricted"; status: number } | { kind: "not_json"; contentType: string | null } | { kind: "http"; status: number }`;
  - `feedProblem(answer: { status: number; contentType: string | null; body: string }): FeedProblem | null` (null: a 2xx JSON body, a usable answer);
  - `feedProblemMessage(problem: FeedProblem): string`;
  - the registry's new `feed_type` `"bot_blocked"`.
- The messages, exactly:
  - "blocked by a bot check (Cloudflare)" / "(Incapsula)";
  - "restricted by the site (HTTP 403)", only when a 401 or 403 body is JSON;
  - "not valid JSON (text/html)" for a 2xx that isn't JSON, or "(no content type)";
  - "HTTP 403" for any other refusal.
- `fetchFeed` keeps its `FeedFetchResult` type; `Detection` gains `{ feedType: "bot_blocked"; feedUrl: null; notes: string }`.

- [ ] **Step 1: The fixtures.** Create the four files exactly.

`packages/feed-kit/test/fixtures/cloudflare-challenge.html` (the page Cloudflare serves with 403 `text/html`; trimmed to its identifying parts, ray ID zeroed):

```text
<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title><meta http-equiv="refresh" content="390"></head><body><div class="main-wrapper" role="main"><div class="main-content"><noscript><div class="h2"><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></div></noscript></div></div><script>(function(){window._cf_chl_opt={cvId: '3',cZone: "example.org",cType: 'managed',cRay: '0000000000000000'};var a = document.createElement('script');a.src = '/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1?ray=0000000000000000';document.getElementsByTagName('head')[0].appendChild(a);}());</script></body></html>
```

`packages/feed-kit/test/fixtures/incapsula-challenge.html` (served with 200 `text/html`; incident ID zeroed):

```text
<html style="height:100%"><head><META NAME="ROBOTS" CONTENT="NOINDEX, NOFOLLOW"><meta name="format-detection" content="telephone=no"><meta name="viewport" content="initial-scale=1.0"></head><body style="margin:0px;height:100%"><iframe id="main-iframe" src="/_Incapsula_Resource?SWUDNSAI=31&xinfo=0&incident_id=0000000000000000000-000000000000000000&edet=12&cinfo=04000000&mth=GET" frameborder=0 width="100%" height="100%" marginheight="0px" marginwidth="0px">Request unsuccessful. Incapsula incident ID: 0000000000000000000-000000000000000000</iframe></body></html>
```

`packages/feed-kit/test/fixtures/tsml-restricted.json` (Western Colorado's 403 `application/json` body, byte for byte, 93 bytes with no newline at the end):

```text
{"code":"feed_restricted","message":"This meeting list is restricted.","data":{"status":403}}
```

`packages/feed-kit/test/fixtures/plain-page.html` (an ordinary page where a feed was expected):

```text
<!doctype html><html><head><title>Meetings</title></head><body><h1>Find a meeting</h1></body></html>
```

Write the files with no trailing newline (`printf '%s'`), so `tsml-restricted.json` is exactly 93 bytes (`wc -c`). Add `packages/feed-kit/test/fixtures/` to `.prettierignore`, so the recorded bytes are never reformatted.

- [ ] **Step 2: Failing classifier tests.** Create `packages/feed-kit/test/feed-problem.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { feedProblem, feedProblemMessage } from "../src/index";

// Response shapes recorded on 2026-10-02 (the challenge pages trimmed, their IDs zeroed); never a live site.
const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8");
const CLOUDFLARE = fixture("cloudflare-challenge.html");
const INCAPSULA = fixture("incapsula-challenge.html");
const TSML_RESTRICTED = fixture("tsml-restricted.json");
const PLAIN_PAGE = fixture("plain-page.html");

const described = (status: number, contentType: string | null, body: string) => {
  const problem = feedProblem({ status, contentType, body });
  return problem === null ? null : feedProblemMessage(problem);
};

describe("feedProblem", () => {
  it("names Cloudflare's challenge page, served as a 403", () => {
    expect(feedProblem({ status: 403, contentType: "text/html; charset=UTF-8", body: CLOUDFLARE })).toEqual({
      kind: "bot_check",
      by: "Cloudflare",
    });
    expect(described(403, "text/html; charset=UTF-8", CLOUDFLARE)).toBe(
      "blocked by a bot check (Cloudflare)",
    );
  });

  it("names Incapsula's challenge page, even when it comes with a 200", () => {
    expect(described(200, "text/html", INCAPSULA)).toBe("blocked by a bot check (Incapsula)");
  });

  it("calls a 403 restricted only when the site says so in JSON, as TSML does", () => {
    expect(TSML_RESTRICTED.length).toBe(93);
    expect(described(403, "application/json; charset=UTF-8", TSML_RESTRICTED)).toBe(
      "restricted by the site (HTTP 403)",
    );
    expect(described(401, "application/json", '{"error":"HTTP/1.1 401 Unauthorized"}')).toBe(
      "restricted by the site (HTTP 401)",
    );
  });

  it("calls a 403 that's an ordinary page just an HTTP 403", () => {
    expect(described(403, "text/html", PLAIN_PAGE)).toBe("HTTP 403");
  });

  it("says what came instead of JSON on a 200", () => {
    expect(described(200, "text/html; charset=UTF-8", PLAIN_PAGE)).toBe("not valid JSON (text/html)");
    expect(described(200, null, "<html>")).toBe("not valid JSON (no content type)");
  });

  it("reports any other refusal by its status", () => {
    expect(described(500, "text/html", PLAIN_PAGE)).toBe("HTTP 500");
  });

  it("finds nothing wrong with a JSON feed, even one whose text mentions a challenge", () => {
    expect(
      described(200, "application/json", '[{"slug":"a","notes":"Just a moment... we start late"}]'),
    ).toBeNull();
  });
});
```

Run `pnpm --filter @mymeetingapp/feed-kit test feed-problem`. Expected: FAIL; the exports don't exist.

- [ ] **Step 3: The classifier.** Create `packages/feed-kit/src/feed-problem.ts`:

```ts
// Spec §4: why a feed's answer isn't a usable feed, in the words the admin reads on /metrics and in coverage.md. A bot
// check (a challenge page served in place of the feed) is recorded and reported, never worked around: requests keep our
// honest User-Agent, never imitate a browser, curl or its TLS, and are never retried to slip past one.
export type BotCheck = "Cloudflare" | "Incapsula";

export type FeedProblem =
  | { kind: "bot_check"; by: BotCheck }
  | { kind: "restricted"; status: number }
  | { kind: "not_json"; contentType: string | null }
  | { kind: "http"; status: number };

// What each service's challenge page carries, in place of the page asked for.
const BOT_CHECKS: readonly { by: BotCheck; signs: readonly string[] }[] = [
  { by: "Cloudflare", signs: ["<title>Just a moment...</title>", "/cdn-cgi/challenge-platform/"] },
  { by: "Incapsula", signs: ["_Incapsula_Resource"] },
];

function isJson(body: string): boolean {
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

// The media type alone: "text/html; charset=UTF-8" is "text/html".
function mediaType(contentType: string | null): string | null {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  return type === undefined || type === "" ? null : type;
}

// null when the answer is a 2xx JSON body. A JSON body is never a bot check, whatever its text says.
export function feedProblem(answer: {
  status: number;
  contentType: string | null;
  body: string;
}): FeedProblem | null {
  const json = isJson(answer.body);
  const botCheck = json
    ? undefined
    : BOT_CHECKS.find(({ signs }) => signs.some((sign) => answer.body.includes(sign)));
  if (botCheck !== undefined) return { kind: "bot_check", by: botCheck.by };
  if ((answer.status === 401 || answer.status === 403) && json)
    return { kind: "restricted", status: answer.status };
  if (answer.status < 200 || answer.status >= 300) return { kind: "http", status: answer.status };
  return json ? null : { kind: "not_json", contentType: mediaType(answer.contentType) };
}

export function feedProblemMessage(problem: FeedProblem): string {
  switch (problem.kind) {
    case "bot_check":
      return `blocked by a bot check (${problem.by})`;
    case "restricted":
      return `restricted by the site (HTTP ${String(problem.status)})`;
    case "not_json":
      return `not valid JSON (${problem.contentType ?? "no content type"})`;
    case "http":
      return `HTTP ${String(problem.status)}`;
  }
}
```

Add `export * from "./feed-problem";` to `packages/feed-kit/src/index.ts`. Run the test again. Expected: PASS.

- [ ] **Step 4: Failing sync tests.** In `apps/web/test/fetch-feed.test.ts`, read the fixtures from feed-kit:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";

const fixture = (name: string) =>
  readFileSync(path.resolve(import.meta.dirname, "../../../packages/feed-kit/test/fixtures", name), "utf8");
```

Replace the `it.each` of statuses and "reports a body that isn't JSON" with:

```ts
it.each<[string, { status: number; body: string; headers?: Record<string, string> }, string]>([
  [
    "TSML's restriction",
    {
      status: 403,
      body: fixture("tsml-restricted.json"),
      headers: { "Content-Type": "application/json; charset=UTF-8" },
    },
    "restricted by the site (HTTP 403)",
  ],
  [
    "a Cloudflare challenge",
    {
      status: 403,
      body: fixture("cloudflare-challenge.html"),
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    },
    "blocked by a bot check (Cloudflare)",
  ],
  [
    "an Incapsula challenge served as a 200",
    { status: 200, body: fixture("incapsula-challenge.html"), headers: { "Content-Type": "text/html" } },
    "blocked by a bot check (Incapsula)",
  ],
  [
    "an ordinary page",
    {
      status: 200,
      body: fixture("plain-page.html"),
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    },
    "not valid JSON (text/html)",
  ],
  ["a server error", { status: 500, body: "{}" }, "HTTP 500"],
])("reports %s as its own error", async (_what, reply, message) => {
  const server = await serve(() => reply);
  expect(await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle())).toEqual({
    kind: "error",
    message,
  });
});

// Spec §4: never past a bot check. One request, with our own User-Agent, and no second try.
it("asks a bot-checked feed once, as itself, and never again in that run", async () => {
  const server = await serve(() => ({
    status: 403,
    body: fixture("cloudflare-challenge.html"),
    headers: { "Content-Type": "text/html" },
  }));
  await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle());
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]?.headers["user-agent"]).toBe(
    "mymeetingapp/1.0 (+https://mymeetingapp.com; admin@goodersoftwarellc.com)",
  );
});
```

In `apps/web/test/run-sync.test.ts`, "records a restricted feed and doesn't retry it on the next run" serves TSML's body:

```ts
const restricted = await feedServing("restricted", () => ({
  status: 403,
  body: '{"code":"feed_restricted","message":"This meeting list is restricted.","data":{"status":403}}',
  headers: { "Content-Type": "application/json" },
}));
await runSync(60_000);
expect((await feed(restricted.id))?.lastError).toBe("restricted by the site (HTTP 403)");
```

Run `pnpm --filter web exec vitest run fetch-feed run-sync`. Expected: FAIL.

- [ ] **Step 5: `fetchFeed` reads the answer before judging it.** Replace the body of `fetchFeed` after the `304` check with:

```ts
// The body is read (capped) even on a refusal: only it tells a site's own restriction from a bot check.
const text = await readBodyCapped(response);
if (text === null) return { kind: "error", message: "too large" };
const problem = feedProblem({
  status: response.status,
  contentType: response.headers.get("content-type"),
  body: text,
});
if (problem !== null) return { kind: "error", message: feedProblemMessage(problem) };
return {
  kind: "ok",
  body: JSON.parse(text),
  etag: response.headers.get("etag"),
  lastModified: response.headers.get("last-modified"),
};
```

importing `feedProblem` and `feedProblemMessage` from `@mymeetingapp/feed-kit`. Run `pnpm --filter web exec vitest run fetch-feed run-sync`. Expected: PASS.

- [ ] **Step 6: Failing discovery tests.** In `tools/feed-discovery/test/detect.test.ts` (with the same `fixture` helper, resolving `../../../packages/feed-kit/test/fixtures`):

```ts
it.each([
  ["Cloudflare", 403, "cloudflare-challenge.html"],
  ["Incapsula", 200, "incapsula-challenge.html"],
])("records a site behind a %s bot check and stops probing it", async (by, status, file) => {
  const s = await site({
    "/wp-json/tsml/meetings": { status, body: fixture(file), headers: { "Content-Type": "text/html" } },
  });
  expect(await detectFeed(s.baseUrl, createCrawler())).toEqual({
    feedType: "bot_blocked",
    feedUrl: null,
    notes: `blocked by a bot check (${by})`,
  });
  // Spec §4: one honest request, then nothing more to that site, and never a second User-Agent.
  expect(s.requests.map((r) => r.path)).toEqual(["/robots.txt", "/wp-json/tsml/meetings"]);
  expect(new Set(s.requests.map((r) => r.headers["user-agent"]))).toEqual(
    new Set(["mymeetingapp/1.0 (+https://mymeetingapp.com; admin@goodersoftwarellc.com)"]),
  );
});

it("still records TSML's own JSON restriction as restricted, not as a bot check", async () => {
  const s = await site({
    "/wp-json/tsml/meetings": { status: 403, body: fixture("tsml-restricted.json"), headers: json },
  });
  expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({ feedType: "restricted" });
});
```

In `tools/feed-discovery/test/report.test.ts`, add:

```ts
it("lists bot-blocked sites under their own heading, apart from restricted feeds", () => {
  const entry = (id: string, name: string, feedType: RegistryEntry["feed_type"]): RegistryEntry => ({
    id,
    name,
    entity_type: "intergroup",
    state: "TX",
    website: `https://${id}.example.org`,
    feed_type: feedType,
    feed_url: null,
    verified: false,
    meeting_count: 0,
    states_covered: [],
    cities_covered: [],
    checked_at: "2026-10-02",
    notes: "",
  });
  const markdown = renderCoverage(
    [
      entry("houston", "Houston Intergroup", "bot_blocked"),
      entry("western-co", "Western Colorado", "restricted"),
    ],
    [],
    { stoppedResponding: [], removedFromDirectory: [], newEntities: [], countDrops: [] },
  );
  expect(markdown).toContain(
    "## Blocked by a bot check: ask the site to allow mymeetingapp's User-Agent\n\n- Houston Intergroup (TX) — https://houston.example.org",
  );
  expect(markdown).toContain(
    "## Restricted feeds (contact the intergroup)\n\n- Western Colorado (TX) — https://western-co.example.org",
  );
});
```

(importing `type RegistryEntry` from `@mymeetingapp/feed-kit` if the file doesn't already). Run `pnpm --filter feed-discovery test`. Expected: FAIL.

- [ ] **Step 7: Discovery classifies with the same function.**
  - **`packages/feed-kit/src/registry.ts`:** add `"bot_blocked"` to `FEED_TYPES`, after `"restricted"`.
  - **`tools/feed-discovery/src/detect.ts`:** add `| { feedType: "bot_blocked"; feedUrl: null; notes: string }` to `Detection`, and:

```ts
// Spec §4: a bot check in front of the site is recorded and the site left alone. Probing on would only knock on the
// same wall, and nothing here ever tries to get past one.
function botCheck(result: CrawlResult): Detection | null {
  if (result.kind !== "response") return null;
  const problem = feedProblem({ status: result.status, contentType: result.contentType, body: result.body });
  return problem?.kind === "bot_check"
    ? { feedType: "bot_blocked", feedUrl: null, notes: feedProblemMessage(problem) }
    : null;
}
```

    importing `feedProblem` and `feedProblemMessage` from `@mymeetingapp/feed-kit`. In `detectFeed`, make `probe` stop at a bot check by checking each of the three fixed probes. Insert `const blockedAtRest = botCheck(restResult); if (blockedAtRest !== null) return blockedAtRest;` right after the REST probe; the same after the AJAX probe (`ajaxResult`) and after the homepage probe (`homeResult`).

- **`tools/feed-discovery/src/report.ts`:** in `renderCoverage`, add `const botBlocked = entries.filter((entry) => entry.feed_type === "bot_blocked");`, and before the restricted block:

```ts
    `## Blocked by a bot check: ask the site to allow mymeetingapp's User-Agent\n\n${listOrNone(botBlocked.map(backlogLine))}`,
```

    Update `renderCoverage`'s comment to name the new list. `seed-feeds.ts` already seeds only `tsml`, `meeting_guide_json` and `google_sheet`, so a `bot_blocked` entry is never seeded.

Run `pnpm --filter feed-discovery test && pnpm --filter @mymeetingapp/feed-kit test`. Expected: PASS, with the existing report snapshot gaining the new heading with "None." (update that expected text in `report.test.ts` to include `## Blocked by a bot check: ask the site to allow mymeetingapp's User-Agent\n\nNone.` before the restricted heading).

- [ ] **Step 8: Spec, standards, commit.**
  - **`SPEC.md` §4, under "Restricted feeds":** add: "**Bot checks:** a site that answers with a bot-check page (Cloudflare's or Incapsula's challenge) is recorded as `bot_blocked` and listed separately in the report as 'ask the site to allow mymeetingapp's User-Agent'. Never try to get past one: no browser or curl User-Agent, no TLS imitation, no retries meant to slip through."
  - **`docs/standards.md`, "Polite HTTP for feeds":** append "A feed answer that isn't a usable feed is described only by `feedProblem` / `feedProblemMessage` from `@mymeetingapp/feed-kit` (the site's JSON restriction, a bot check, not JSON, an HTTP status), in the sync and in discovery alike. A bot check is recorded, never worked around: the honest User-Agent stays, nothing imitates a browser, curl or its TLS, and nothing retries to slip past it."

  Then `pnpm check`, and:

```bash
git add .prettierignore packages/feed-kit apps/web/src/server/feeds apps/web/test tools/feed-discovery/src tools/feed-discovery/test docs/standards.md SPEC.md
git commit -m "feat(feeds): tell a bot check from a site's own restriction, in the sync and in discovery"
```

The committed `registry.yaml` and `coverage.md` change only on the next discovery run, which reclassifies these sites. The sync's `last_error` changes on each feed's next attempt.

---

### Task 13: "Search farther" when a place has no in-person meetings nearby

A place search or "Use my location" asks for 25 km (`SEARCH_RADIUS_KM`, "within 16 miles"). Durango, CO finds nothing, though meetings exist about 50 km away. `MeetingSearchRequest` already allows `radiusKm` up to 100.

When such a search comes back with no in-person meetings, Nearby offers one "Search farther". It repeats the same rounded point at 97 km (`WIDER_SEARCH_RADIUS_KM`, "within 60 miles"), and the list shows each meeting's distance as usual. If that is empty too, the existing online-meetings fallback stays.

Privacy and scope:

- The wider radius belongs to that one search; a new place, a recent place, "Use my location" or "Change place" starts again at 25 km.
- Nothing new leaves the phone: the same rounded point, a bigger number.

**Map: recommend zooming out to fit (the owner confirms at review).** "Search farther" is a new search like any other, so the map remounts around it with `regionAround(point, 100)`, about 1.8° of latitude. The meetings it found are then on screen, not off its edges, and nothing new is built: `regionAround` already sizes the map from the search's radius. The alternative, keeping the 25 km view, would show an empty map with the meetings just out of sight.

**Files:**

- Modify: `apps/mobile/src/location/geo.ts`, `apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/test/nearby.test.tsx`, `apps/mobile/test/map.test.tsx`, `SPEC.md` §8, `docs/standards.md`

**Interfaces:**

- Consumes: `searchRead`, `SearchOrigin` (5a); `TestApi.replyOnce` (Task 8).
- Produces: `WIDER_SEARCH_RADIUS_KM = 97` from `@/location/geo`; `Results` gains `onFarther: () => void`, offered only when the search is a place's or near the person (`kind !== "map"`), asked at less than 97 km, and showing its own answer (not the last search standing in for it offline).

- [ ] **Step 1: Failing list tests.** Add to `apps/mobile/test/nearby.test.tsx`, in a new `describe("Search farther")` (using the file's `searchFor`, `searchBodies`, `far` and `SEARCH`):

```tsx
describe("Search farther", () => {
  const NONE_NEAR = "No in-person meetings within 16 miles of Maryville, TN.";
  const farther = () => screen.findByRole("button", { name: "Search farther" });

  it("repeats the same rounded point at 97 km when a place has nothing within 16 miles", async () => {
    api.reply(SEARCH, { meetings: [far] });
    api.replyOnce(SEARCH, { meetings: [] });
    await launchNearby();
    await searchFor("Maryville, TN");
    expect(await screen.findByText(NONE_NEAR)).toBeOnTheScreen();
    expect(await farther()).toHaveProp("accessibilityHint", "Searches within 60 miles of Maryville, TN");
    await fireEvent.press(await farther());
    expect(await screen.findByText("Far Group")).toBeOnTheScreen();
    // The distance shows as for any search, from the place itself.
    expect(screen.getByText("Mon 7:00 PM · 1.4 mi")).toBeOnTheScreen();
    expect(searchBodies()).toEqual([
      { lat: 35.76, lng: -83.97, radiusKm: 25 },
      { lat: 35.76, lng: -83.97, radiusKm: 97 },
    ]);
    expect(screen.queryByRole("button", { name: "Search farther" })).toBeNull();
  });

  it("falls back to the online meetings when 60 miles finds nothing either, and offers no more", async () => {
    api.reply(SEARCH, { meetings: [] });
    await launchNearby();
    await searchFor("Maryville, TN");
    await fireEvent.press(await farther());
    expect(
      await screen.findByText("No in-person meetings within 60 miles of Maryville, TN."),
    ).toBeOnTheScreen();
    expect(screen.getByText("Online meetings you can join")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Search farther" })).toBeNull();
  });

  it("starts the next place at 16 miles again", async () => {
    api.reply(SEARCH, { meetings: [] });
    await launchNearby();
    await searchFor("Maryville, TN");
    await fireEvent.press(await farther());
    await screen.findByText("No in-person meetings within 60 miles of Maryville, TN.");
    await fireEvent.press(screen.getByRole("button", { name: "Change place" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Maryville, TN" }));
    // The 16-mile answer (its saved copy is still fresh, so it may come from the phone) and the offer again: the
    // wider radius belonged to that one search.
    expect(await screen.findByText(NONE_NEAR)).toBeOnTheScreen();
    expect(await farther()).toBeOnTheScreen();
    expect(searchBodies().filter((body) => JSON.stringify(body).includes('"radiusKm":100'))).toHaveLength(1);
  });

  it("offers it after Use my location too, from the same rounded point", async () => {
    api.reply(SEARCH, { meetings: [] });
    await launchNearby();
    await fireEvent.press(await screen.findByRole("button", { name: "Use my location" }));
    await fireEvent.press(await farther());
    expect(await screen.findByText("No in-person meetings within 60 miles of you.")).toBeOnTheScreen();
    expect(searchBodies()).toEqual([
      { lat: 36.16, lng: -86.78, radiusKm: 25 },
      { lat: 36.16, lng: -86.78, radiusKm: 97 },
    ]);
  });

  // Offline, the wider search has no copy of its own, so the one search kept stands in for it (spec §8), said as such;
  // it's that search's own 16-mile answer, so nothing farther is offered on it.
  it("offline, shows the last search in its place, said so, and offers nothing farther on it", async () => {
    api.reply(SEARCH, { meetings: [] });
    await launchNearby();
    await searchFor("Maryville, TN");
    const button = await farther();
    await api.close();
    await fireEvent.press(button);
    expect(
      await screen.findByText(
        "Showing your last search, near Maryville, TN, saved today at 5:30 AM. We couldn't reach mymeetingapp, so it may be out of date.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText(NONE_NEAR)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Search farther" })).toBeNull();
    expect(screen.getByRole("button", { name: "Change place" })).toBeOnTheScreen();
    api = await startApi();
  });
});
```

Run `pnpm --filter mobile test nearby`. Expected: FAIL; there is no "Search farther".

- [ ] **Step 2: Failing map test.** Add to `apps/mobile/test/map.test.tsx`:

```tsx
// Owner to confirm at review: the wider search zooms the map out to fit its 60 miles.
it("offers Search farther over an empty map, and opens the map around the wider search", async () => {
  api.reply(SEARCH, { meetings: [far] });
  api.replyOnce(SEARCH, { meetings: [] });
  await launchNearby();
  await fireEvent.changeText(await screen.findByLabelText("Search for a place"), "Maryville, TN");
  await fireEvent.press(screen.getByRole("button", { name: "Search" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Map" }));
  await fireEvent.press(await screen.findByRole("button", { name: "Search farther" }));
  expect(await screen.findByRole("button", { name: /Far Group/ })).toBeOnTheScreen();
  expect(mapProps().initialRegion.latitudeDelta).toBeCloseTo(1.7966, 4);
  expect(searchBodies().at(-1)).toEqual({ lat: 35.76, lng: -83.97, radiusKm: 97 });
});
```

Run `pnpm --filter mobile test map`. Expected: FAIL.

- [ ] **Step 3: The radius and the action.** In `src/location/geo.ts`, after `SEARCH_RADIUS_KM`:

```ts
// "Search farther", offered once when a place or near-me search finds no in-person meetings: the same point, at 97 km,
// which radiusMiles shows as 60 miles (owner decision, 2026-10-02: a round number US readers know). For that one search only.
export const WIDER_SEARCH_RADIUS_KM = 97;
```

In `src/app/(tabs)/index.tsx`:

- import `WIDER_SEARCH_RADIUS_KM`;
- add `onFarther: () => void` to `ResultsProps`, with the comment "Searches the same place again at WIDER_SEARCH_RADIUS_KM.", and take it in `Results`;
- after `noneNearby`, add:

```tsx
// Offered once, for a place or near-me search's own empty answer: never for a map area (a pan sets its own radius),
// never after it was already used, and not on the last search standing in for this one offline.
const fartherButton = asked.kind !== "map" &&
  asked.radiusKm < WIDER_SEARCH_RADIUS_KM &&
  !origin.lastSearch && (
    <View style={{ alignSelf: "flex-start" }}>
      <Button
        kind="secondary"
        label="Search farther"
        hint={`Searches within ${String(radiusMiles(WIDER_SEARCH_RADIUS_KM))} miles of ${origin.label}`}
        onPress={onFarther}
      />
    </View>
  );
```

- on the map, inside the `state.data.meetings.length === 0` card, after `<AppText>{noneNearby}</AppText>`, add `{fartherButton}`;
- in the list's empty return, after `<AppText>{noneNearby}</AppText>`, add `{fartherButton}`, before `{onlineInstead}`.

In `Nearby`, pass the action. It's a search like any other, so the results (and the map) remount around it, and a new search forgets it:

```tsx
        onFarther={() => {
          begin();
          search({ ...origin, radiusKm: WIDER_SEARCH_RADIUS_KM });
        }}
```

Run `pnpm --filter mobile test nearby map`. Expected: PASS.

- [ ] **Step 4: Spec, standards, commit.**
  - **`SPEC.md` §8, "Searching another area":** replace "If no in-person meetings are found, say so plainly and show the online meetings view rather than an empty screen." with "If no in-person meetings are found, say so plainly and offer 'Search farther' once: the same rounded point at 97 km (60 miles), for that search only (a new place or 'Change place' starts at 25 km again), with the map zoomed out to fit it. If there are still none, show the online meetings view rather than an empty screen."
  - **`docs/standards.md`, "Location and places in the app":** append "A place or near-me search asks at `SEARCH_RADIUS_KM`; when it finds no in-person meetings, Nearby offers 'Search farther' once, the same origin at `WIDER_SEARCH_RADIUS_KM`, for that search only (`onFarther`), so only the radius changes on the wire."

  Then `pnpm check`, and:

```bash
git add apps/mobile/src apps/mobile/test SPEC.md docs/standards.md
git commit -m "feat(mobile): Search farther when a place has no in-person meetings within 16 miles"
```

---

### Task 14: Staging — the code live with checks off, an attesting TestFlight build, the iPhone audit, then checks on

The first time real Apple attestations reach the server. The order keeps every step reversible:

1. Merge, so staging and production run the code with checks off.
2. Set the Apple variables on staging.
3. Ship the TestFlight build and watch real registrations land.
4. Audit an iPhone's traffic.
5. Only then switch staging's checks on.

Production stays off until Task 15. Nothing here touches production data.

**Files:** Modify `docs/deploy.md` ("Phase 6"), `docs/mobile.md` (local setup, TestFlight, audit log).

- [ ] **Step 1: End-of-phase code checks.**
  - Run `pnpm check`, `pnpm knip:production` and `pnpm --filter web test:e2e`. Expected: all pass. `knip:production` confirms every new shared export has a production consumer.
  - Run `pnpm --filter mobile exec expo install --check` (up to date) and `pnpm --filter mobile dlx expo-doctor` (no failed checks).

- [ ] **Step 2: The PR.** Push `phase-6-integrity`. Then open the PR: `gh pr create --base main --title "Phase 6: App Attest, DeviceCheck, privacy manifest, App Store listing, feed errors and Search farther"`.
  - The body lists Tasks 2–13, the owner decisions, and that checks stay off until Tasks 14 and 15. It ends with the PR attribution line.
  - After CI is green, the owner merges.
  - Merging deploys production with `REQUIRE_ATTESTATION=off`. Watch it with `vercel inspect <url> --logs`. Expected: migrations `0016_attestation` and `0017_attestation-limit` apply, then the build. Both migrations only add, so the previous deployment kept working during the build.

- [ ] **Step 3 (Claude, with the owner's go-ahead): Apple variables on staging and production.** None is secret. From `apps/web`, without printing anything else:

```bash
cd apps/web && for target in staging production; do
  for pair in "APPLE_TEAM_ID=PVCZBLDJ73" "APPLE_BUNDLE_ID=com.goodersoftware.mymeetingapp" "APP_ATTEST_ENVIRONMENT=production"; do
    printf '%s' "${pair#*=}" | vercel env add "${pair%%=*}" "$target" --scope huntonas-projects
  done
done && vercel env ls staging --scope huntonas-projects | grep -cE 'APPLE_TEAM_ID|APPLE_BUNDLE_ID|APP_ATTEST_ENVIRONMENT'
```

Expected: `3`. Staging gets no DeviceCheck key (decision 8).

- [ ] **Step 4 (Claude, with the owner's go-ahead): deploy staging and check it.** `git fetch origin && git push origin origin/main:staging`. Watch the build: expected "Not a preview build; database branch left alone", the two migrations, then Next. Then, with a throwaway device:

```bash
S=https://mymeetingapp-staging.vercel.app
D="curl-check-$(openssl rand -hex 8)"; H=(-H "X-Device-Id: $D" -H "X-Platform: ios" -H "X-App-Version: 1.0.0")
curl -s "${H[@]}" -X POST "$S/api/v1/attest/challenge" | jq -c '{length: (.challenge | length)}'        # {"length":43}
curl -s -X POST "$S/api/v1/attest/challenge" | jq -c .error.code                                     # "invalid_request"
curl -s "${H[@]}" -H 'content-type: application/json' -X POST "$S/api/v1/attest/register" \
  -d '{"keyId":"zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=","attestation":"o2NmbXQ=","challenge":"ccccccccccccccccccccccccccccccccccccccccccc"}' | jq -c .error.code   # "attestation_failed"
curl -s "${H[@]}" -X POST "$S/api/v1/tags/delete-mine" | jq -c .                                     # {"deletedTags":0} (checks still off)
```

Expected: the answers in the comments. Record them in `docs/deploy.md` under "Phase 6".

- [ ] **Step 5 (Claude): the TestFlight build.** The native module is new, so this is a new binary. Before building, make sure the owner's Task 1 Step 2 checks are done or still pending; either way the build uses team `PVCZBLDJ73`.

```bash
cd apps/mobile && pnpm dlx eas-cli@24.8.0 build --platform ios --profile testflight --auto-submit --non-interactive
```

Expected:

- The log shows EAS syncing the App Attest capability onto `com.goodersoftware.mymeetingapp`. If the build instead fails on the App Attest entitlement, the owner turns App Attest on for that identifier (Certificates, Identifiers & Profiles → Identifiers → the app → App Attest → Save), and Claude reruns.
- The submission finishes with no Apple sign-in. That proves the App Store Connect API key `ZG2Z6A5JY3` still works after the conversion (Task 1 Step 2.6).

Record the build number in `docs/mobile.md` under "TestFlight builds".

- [ ] **Step 6 (Owner, with Claude watching staging): real registrations.**
  1. Install the build from TestFlight on the iPhone and open a staging meeting that is in its tagging window.
  2. Tag it, edit, remove, suggest "Candlelight", then "Delete all my tags", then tag again.
  3. Vercel → Logs, staging: `POST /api/v1/attest/challenge` 201 and `POST /api/v1/attest/register` 201, twice (the second after Delete all), and every write 2xx.
  4. Neon SQL editor on the `staging` branch:

     `select count(*) as phones_with_keys, max(attest_counter) as highest_counter from devices where attest_key_id is not null;`

     Expected: at least 1, and a counter of at least 1.

  5. Search "Durango, CO". If nothing is within 16 miles, "Search farther" shows, and the list then gives meetings with their distances (Task 13).

If register answered 401, the attestation didn't verify. Check `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID` and `APP_ATTEST_ENVIRONMENT=production` on staging first; TestFlight builds attest in production.

- [ ] **Step 7: the iPhone network audit.** A simulator can't attest, so this one runs on the owner's iPhone, with the TestFlight build, against staging. Follow `docs/mobile.md`'s audit steps (5a runbook step 9, "the owner's iPhone"):
  1. `mitmdump --listen-host 0.0.0.0 --listen-port 8080 --set hardump="$HOME/mma-audit-6-iphone.har"`.
  2. iPhone: Wi-Fi → Configure Proxy → Manual, the Mac's LAN address, port 8080. Install the profile from `http://mitm.it`, and trust it fully (Settings → General → About → Certificate Trust Settings).
  3. In the app:
     - search "Maryville, TN 37804";
     - set the sobriety date to April 17, 2011;
     - tag a meeting in its window, edit, remove, suggest a word;
     - "Delete all my tags", then tag again (a second registration).
  4. Stop `mitmdump`. Remove the proxy and the profile from the iPhone. Then:

```bash
pnpm --filter network-audit check-har --har "$HOME/mma-audit-6-iphone.har" --server mymeetingapp-staging.vercel.app \
  --private 2011-04-17 --private "Apr 17, 2011" --search-text "Maryville, TN 37804" --search-text "37804"
```

Expected: PASS; "Writes checked" at least 9 (two challenges, two registrations, the five writes); one user agent. Record it in `docs/mobile.md`'s audit log with the other hosts seen; Apple's attestation hosts (`*.apple.com`) are expected. Then `rm "$HOME"/mma-audit-6-*.har`.

- [ ] **Step 8 (Claude, with the owner's go-ahead): switch staging's checks on.**

```bash
cd apps/web && vercel env rm REQUIRE_ATTESTATION staging --yes --scope huntonas-projects \
  && printf 'on' | vercel env add REQUIRE_ATTESTATION staging --scope huntonas-projects
```

A variable takes effect only on a new deployment, so redeploy staging's current deployment: `vercel redeploy <staging deployment url> --scope huntonas-projects` (the URL from Step 4's build). Then:

```bash
S=https://mymeetingapp-staging.vercel.app
D="curl-check-$(openssl rand -hex 8)"; H=(-H "X-Device-Id: $D" -H "X-Platform: ios" -H "X-App-Version: 1.0.0")
curl -s "${H[@]}" -X POST "$S/api/v1/tags/delete-mine" | jq -c .error.code                       # "attestation_failed"
curl -s "${H[@]}" -H "X-Attestation: devicecheck.v1.AAAA" -X POST "$S/api/v1/tags/delete-mine" | jq -c .error.code   # "attestation_failed" (no DeviceCheck key on staging)
```

On the iPhone (TestFlight): tag, edit, remove, "Delete all my tags", then tag again. Every one succeeds with no message.

On the simulator (a dev build pointed at staging): a tag shows "We couldn't confirm this request came from the app. Please update the app and try again." That's expected; record it.

- [ ] **Step 9: Docs and commit** (on a branch `phase-6-release` from `main`).
  - **`docs/deploy.md` "Phase 6":** add this table and Steps 4, 6 and 8's results:

    | Variable                                         | Local (`.env.local`)                         | Preview | Staging                      | Production                       |
    | ------------------------------------------------ | -------------------------------------------- | ------- | ---------------------------- | -------------------------------- |
    | `REQUIRE_ATTESTATION`                            | off                                          | off     | on (from TestFlight build N) | on (Task 15)                     |
    | `APPLE_TEAM_ID` / `APPLE_BUNDLE_ID`              | PVCZBLDJ73 / com.goodersoftware.mymeetingapp | unset   | set                          | set                              |
    | `APP_ATTEST_ENVIRONMENT`                         | development                                  | unset   | production                   | production                       |
    | `DEVICECHECK_KEY_ID` / `DEVICECHECK_PRIVATE_KEY` | unset                                        | unset   | unset: DeviceCheck refused   | set, the key Sensitive (Task 15) |

    Then the rules: "TestFlight and App Store builds always attest in Apple's production environment. A dev build on a device attests in development, so it works only against local web. A simulator can't attest at all: point it at local web for anything that writes."

  - **`docs/mobile.md` local setup step 2:** add "From Phase 6, staging requires app checks, which a simulator can't make. A dev build pointed at staging reads normally, but its writes are refused: point `.env` at your local web (`pnpm --filter web dev`, where `REQUIRE_ATTESTATION=off`) to try tagging."

  Then:

```bash
git add docs/deploy.md docs/mobile.md
git commit -m "docs: Phase 6 on staging — variables, the iPhone audit, checks switched on"
```

---

### Task 15: Production — checks on, the store build, and the App Review submission

Production has no app users yet, so its checks go on before the first App Store build. App Review then exercises exactly what the public will run.

The production build is the first build ever pointed at production. It reaches only App Review and the owner's one-person "Release check" group, never the staging testers (finding 13).

**Files:**

- Create: `apps/mobile/store/screenshots/1-nearby.png`, `2-map.png`, `3-meeting.png`, `4-tag-picker.png`, `5-me.png`
- Modify: `docs/deploy.md`, `docs/app-store.md` (review history), `docs/mobile.md`

- [ ] **Step 1 (Owner): the gates.** Check `docs/app-store.md`'s release checklist. Then:
  - The restore window (O6) must be done before Step 3. The Firewall rules (O5) are not done, by owner decision 2026-10-04 (paid feature); a site-wide backstop covers them.
  - The legal review (O2) decides Owner decision needed 4 before Step 9. If it isn't finished, the owner either waits or gives an explicit go-ahead to submit with the "Draft" line.
  - The conversion (O1) doesn't block submission; it gates release (Task 16).

- [ ] **Step 2 (Owner): the DeviceCheck key into production.** On the owner's Mac, from `apps/web`, with the `.p8` from the password manager saved briefly as a file:

```bash
cd apps/web && vercel env add DEVICECHECK_PRIVATE_KEY production --sensitive --scope huntonas-projects < "$HOME/Downloads/AuthKey_<KEYID>.p8" \
  && printf '%s' "<KEYID>" | vercel env add DEVICECHECK_KEY_ID production --scope huntonas-projects \
  && rm "$HOME/Downloads/AuthKey_<KEYID>.p8"
```

`<KEYID>` is the 10-character Key ID from Task 1 Step 5; it isn't secret. The `.p8` stays only in the password manager and in Vercel, where a Sensitive value can't be read back.

- [ ] **Step 3 (Claude, with the owner's go-ahead): switch production's checks on.**

```bash
cd apps/web && vercel env rm REQUIRE_ATTESTATION production --yes --scope huntonas-projects \
  && printf 'on' | vercel env add REQUIRE_ATTESTATION production --scope huntonas-projects
```

Then redeploy the current production deployment (Vercel → the project → Deployments → the latest Production → Redeploy, or `vercel redeploy <url> --scope huntonas-projects`). Then check with a throwaway device (nothing is written: every request is refused before any write):

```bash
P=https://mymeetings.app
D="curl-check-$(openssl rand -hex 8)"; H=(-H "X-Device-Id: $D" -H "X-Platform: ios" -H "X-App-Version: 1.0.0")
curl -s "${H[@]}" -X POST "$P/api/v1/tags/delete-mine" | jq -c .error.code                                            # "attestation_failed"
curl -s "${H[@]}" -H "X-Attestation: devicecheck.v1.AAAA" -X POST "$P/api/v1/tags/delete-mine" | jq -c .error.code    # "attestation_failed"
```

The second line is the DeviceCheck credential check. Apple refuses the made-up token (400), which the server turns into `attestation_failed`. If it answers `server_error` instead, Apple refused the provider token: the Key ID, the `.p8` or the team is wrong. Then Vercel's log shows "DeviceCheck answered 401" or 403. Fix that before going on.

**Rollback** for any later step: set `REQUIRE_ATTESTATION=off` the same way and redeploy. Writes then pass without proofs, and nothing else changes.

- [ ] **Step 4 (Claude): screenshots.** On the 6.9" simulator (1320 × 2868), from a Release build pointed at **staging** (same meetings as production; nothing written):

```bash
xcrun simctl boot "iPhone 17 Pro Max" && open -a Simulator \
  && xcrun simctl ui booted appearance light \
  && xcrun simctl location booted set 36.1627,-86.7816 \
  && xcrun simctl status_bar booted override --time "9:41" --dataNetwork wifi --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 \
  && cd apps/mobile && EXPO_PUBLIC_SERVER_URL=https://mymeetingapp-staging.vercel.app EXPO_NO_TELEMETRY=1 npx expo run:ios --configuration Release --device "iPhone 17 Pro Max"
```

Take five screens with `xcrun simctl io booted screenshot apps/mobile/store/screenshots/<name>.png`:

1. `1-nearby.png`: Nearby after "Use my location": today's list, with tags on the cards.
2. `2-map.png`: the map view.
3. `3-meeting.png`: a meeting page with several tags and counts.
4. `4-tag-picker.png`: the tag picker open on a meeting in its window, two words chosen. **Don't send.**
5. `5-me.png`: the Me tab with a sobriety date of one year ago, showing the counter.

No real person's data appears: the date is a sample, and the meetings are public listings. Then check:

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha apps/mobile/store/screenshots/*.png
```

Expected: 1320 × 2868 and `hasAlpha: no` for each. If any has alpha, re-save it without: `sips -s format jpeg -s formatOptions 90 <file>.png --out <file>.jpg`, and keep the JPEG instead. Clear the status bar override with `xcrun simctl status_bar booted clear`. Commit the five files.

- [ ] **Step 5 (Claude, with the owner's go-ahead): push the listing.** `cd apps/mobile && pnpm dlx eas-cli@24.8.0 metadata:push`. Expected: the name, subtitle, description, keywords, URLs, categories, copyright and manual release are set on version 1.0.0.
  - If App Store Connect has no editable 1.0.0 version yet, the owner adds one (App Store → iOS App → **+** Version → 1.0.0), and Claude reruns.
  - If the name is refused as taken, return to Task 1 Step 4.

- [ ] **Step 6 (Owner): the hand entries,** from `docs/app-store.md`:
  - App Privacy, then **Publish**;
  - Age Rating (expected 13+);
  - Content Rights;
  - Pricing (Free) and Availability (United States only; "Make this app available on Mac" and Apple Vision Pro off);
  - App Review Information, with the notes pasted exactly;
  - the five screenshots under the 6.9" display.

- [ ] **Step 7 (Owner): keep testers on staging.** App Store Connect → TestFlight:
  - In the internal group the staging testers use, turn **off** automatic distribution of new builds.
  - Create an internal group "Release check" with only the owner, also without automatic distribution.

  From now on, staging builds are added to the testers' group by hand (`docs/mobile.md` "TestFlight builds" gets this sentence).

- [ ] **Step 8 (Claude): the store build.**

```bash
cd apps/mobile && pnpm dlx eas-cli@24.8.0 build --platform ios --profile production --auto-submit --non-interactive
```

Expected: build N (EAS's next number), pointed at `https://mymeetings.app`, submitted to app `6817873804`. Then inspect what Apple will review. Download the `.ipa` from the build's page (`pnpm dlx eas-cli@24.8.0 build:view <id>` prints the artifact URL):

```bash
cd "$TMPDIR" && rm -rf mma-ipa && mkdir mma-ipa && cd mma-ipa && curl -fsSL -o app.ipa "<artifact url>" && unzip -q app.ipa \
  && plutil -p Payload/mymeetingapp.app/PrivacyInfo.xcprivacy \
  && codesign -d --entitlements :- Payload/mymeetingapp.app 2>/dev/null | grep -A1 appattest \
  && plutil -p Payload/mymeetingapp.app/Info.plist | grep -E 'NSLocation|UIBackgroundModes|ITSAppUsesNonExemptEncryption|CFBundleShortVersionString'
```

Expected:

- the manifest from Task 10: three collected types, four API categories, tracking false;
- the `com.apple.developer.devicecheck.appattest-environment` entitlement;
- `NSLocationWhenInUseUsageDescription`, `NSLocationTemporaryUsageDescriptionDictionary`, `ITSAppUsesNonExemptEncryption` false, version 1.0.0;
- no `NSLocationAlways…` key and no `UIBackgroundModes`.

Then `rm -rf "$TMPDIR/mma-ipa"`.

- [ ] **Step 9 (Owner): the release check, then submit.**
  1. TestFlight: add build N to "Release check" only. Confirm it is in no other group.
  2. Install it, search "Nashville, TN", open a meeting. **Don't tag:** this build writes to production.
  3. Vercel → Logs, Production: `POST /api/v1/meetings/search` from that minute. Staging shows none from the phone then.
  4. Reinstall the staging build from TestFlight afterwards.
  5. App Store Connect → the 1.0.0 version → Build → choose N → **Add for Review** → **Submit to App Review**. Release: "Manually release this version" (set by Step 5; confirm it).

- [ ] **Step 10: If App Review rejects it.** Read the Resolution Center message. Record it, and the answer, under "Review history" in `docs/app-store.md`.
  - A metadata issue is fixed in App Store Connect, or in `store.config.json` followed by a push.
  - A code issue goes through a failing test first, then a new production build (Step 8) and resubmission.
  - A question is answered in the Resolution Center, in the same plain words as the review notes.

- [ ] **Step 11: Docs and commit.** Under "Phase 6" in `docs/deploy.md`, record:
  - production's variables (as Task 14's table: production column filled in);
  - Step 3's two answers;
  - the rollback line.

  Add "Review history" to `docs/app-store.md` with the submission date and build N. Then:

```bash
git add apps/mobile/store docs
git commit -m "docs: production checks on, store build N submitted to App Review"
```

---

### Task 16: The release, and the website links to the App Store

After App Review approves version 1.0.0, it waits in "Pending Developer Release" until the owner releases it. That happens once the seller is Gooder Software LLC, or once the owner decides otherwise (Owner decision needed 1). Then the website's App Store badge becomes a link and the Smart App Banner turns on (spec §9: "iOS Smart App Banner once live").

**Files:**

- Modify: `packages/shared/src/brand.ts`, `apps/web/src/components/store-badges.tsx`, `apps/web/src/app/(site)/layout.tsx`, `apps/web/test/landing-page.test.tsx`, `apps/web/test/seo.test.ts`, `apps/web/test/site.e2e.ts`, `docs/app-store.md`, `docs/superpowers/plans/2026-09-26-roadmap.md`

**Interfaces:**

- Produces: `BRAND.appStoreId = "6817873804"`; the landing page's App Store link `https://apps.apple.com/app/id6817873804`; `<meta name="apple-itunes-app" content="app-id=6817873804">` on every public page.

- [ ] **Step 1 (Owner): release.**
  1. Check the seller. App Store Connect → Business shows Gooder Software LLC as the legal entity, and the version page's App Store preview names it.
  2. If the conversion isn't finished, apply Owner decision needed 1. The recommendation is to wait; "Pending Developer Release" can wait without expiring the approval.
  3. Then choose **Release This Version**.

- [ ] **Step 2 (Owner and Claude): the live listing.** Once https://apps.apple.com/us/app/id6817873804 loads (it can take up to a day):
  - the name and subtitle are the chosen ones, and the seller is "Gooder Software LLC";
  - the age rating is 13+;
  - App Privacy shows "Data Not Linked to You": Location, Identifiers, User Content;
  - "Not available on Mac".

  Install from the App Store on the owner's iPhone, search, and tag a meeting the owner went to (a real production tag). Neon SQL on production: `select count(*) from devices where attest_key_id is not null;` is at least 1. Record the date and results under "Review history" in `docs/app-store.md`.

- [ ] **Step 3: Failing website tests** (branch `phase-6-app-store-link` from `main`). In `apps/web/test/landing-page.test.tsx`, replace "shows both stores as coming soon, with no store links yet" with:

```ts
  it("links the App Store listing, and shows Google Play as coming soon until Phase 6b", () => {
    const text = renderText(<HomePage />);
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).toContain('href="https://apps.apple.com/app/id6817873804"');
    expect(text).toContain("Download on the App Store");
    expect(text).toContain("Google Play coming soon");
    expect(html).not.toContain("play.google.com");
  });
```

In `apps/web/test/seo.test.ts`, add:

```ts
import { metadata as siteMetadata } from "@/app/(site)/layout";

describe("the Smart App Banner", () => {
  it("names the App Store app on every public page (spec §9)", () => {
    expect(siteMetadata.itunes).toEqual({ appId: "6817873804" });
  });
});
```

In `apps/web/test/site.e2e.ts`'s "the public site", add:

```ts
it.each(["/", "/privacy", "/terms", "/support"])("%s shows iPhones the Smart App Banner", async (path) => {
  const html = await (await fetch(`${E2E_URL}${path}`)).text();
  expect(html).toContain('<meta name="apple-itunes-app" content="app-id=6817873804"/>');
});
```

Run `pnpm --filter web exec vitest run landing-page seo`. Expected: FAIL.

- [ ] **Step 4: The link and the banner.** In `packages/shared/src/brand.ts`, add `appStoreId: "6817873804",` to `BRAND`, with the comment "The App Store Connect app (the website's App Store link and Smart App Banner)." Replace `apps/web/src/components/store-badges.tsx` with:

```tsx
import { BRAND } from "@mymeetingapp/shared";

// The App Store listing is live (Phase 6). Google Play follows in Phase 6b, so its badge stays plain text until then.
export function StoreBadges() {
  return (
    <ul className="store-badges" aria-label="Download the app">
      <li>
        <a className="store-badge" href={`https://apps.apple.com/app/id${BRAND.appStoreId}`}>
          Download on the App Store
        </a>
      </li>
      <li>
        <span className="store-badge">
          Google Play <small>coming soon</small>
        </span>
      </li>
    </ul>
  );
}
```

In `apps/web/src/app/(site)/layout.tsx`, add:

```tsx
import { BRAND } from "@mymeetingapp/shared";
import type { Metadata } from "next";

// Spec §9: Safari on iPhone offers the app above every public page. It names the app only; nothing is loaded.
export const metadata: Metadata = { itunes: { appId: BRAND.appStoreId } };
```

Run `pnpm --filter web exec vitest run landing-page seo`, then `pnpm --filter web test:e2e`. Expected: PASS.

- [ ] **Step 5: Ship it.** `pnpm check`, then:

```bash
git add packages/shared/src/brand.ts apps/web
git commit -m "feat(web): link the App Store listing and show the Smart App Banner"
```

Open the PR (body ends with the attribution line). Once it's merged, check https://mymeetings.app/: the App Store link opens the listing, and Safari on the iPhone shows the banner.

- [ ] **Step 6: The first week.** Each day, Vercel → Logs, Production, filtered to `/api/v1/tags` and `/api/v1/suggestions`: the share of 401 answers. A 401 is `attestation_failed`.
  - A few are expected (an old simulator, a phone whose clock is days off).
  - A steady stream from real phones means something is wrong: apply Task 15's rollback (`REQUIRE_ATTESTATION=off`, redeploy), then investigate with the staging iPhone.

- [ ] **Step 7: Roadmap and docs.** In the roadmap, mark Phase 6 done: "Released 1.0.0 on the App Store on <date>, build N, seller Gooder Software LLC". In `docs/app-store.md`, tick the release checklist. Commit with `docs: mymeetingapp 1.0 is on the App Store`.

---

### Task 17 (optional): Three 5b minors

PR #18 lists six deferred minors. Three are small and touch nothing above, so they can run at any point after Task 8:

- **Retried removal.** A removal that timed out but succeeded says "You haven't tagged this meeting." when retried; it should say "Your tags are removed."
- **VoiceOver on a deep-linked meeting** reads the back button as "(tabs)".
- **The standards row** for `<YourTags>` doesn't mention its `notice` prop.

The other three stay deferred, in the roadmap's Phase 6 "Later" list:

- the timed-out new tag with no phone record: a retry already finds `already_tagged` and offers an edit;
- the one-minute window edges, which need a timer at the window's exact edge;
- 12-letter words at the largest text size, which need a hyphenation approach on iOS.

**Files:**

- Modify: `apps/mobile/src/ui/your-tags.tsx`, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/test/edit-tags.test.tsx`, `apps/mobile/test/meeting-detail.test.tsx`, `docs/standards.md`, `docs/superpowers/plans/2026-09-26-roadmap.md`

- [ ] **Step 1: Failing tests.** In `apps/mobile/test/edit-tags.test.tsx`, inside "a meeting this phone tagged":

```tsx
it("says the tags are removed when a retry finds none, after a removal it couldn't confirm", async () => {
  // No reply set for the first DELETE: the test server answers 599, as when the connection drops after the server
  // removed them.
  await openTagged();
  await remove();
  expect(
    await screen.findByText(
      "We couldn't reach mymeetingapp, so we can't tell whether your tags were removed. Check your connection and try again.",
    ),
  ).toBeOnTheScreen();
  api.reply(
    TAG_PATH,
    { error: { code: "not_tagged", message: "You haven't tagged this meeting." } },
    404,
    "DELETE",
  );
  await remove();
  expect(await screen.findByText("Your tags are removed.")).toBeOnTheScreen();
  expect(screen.queryByText("You haven't tagged this meeting.")).toBeNull();
  expect(await myTagsOn(ID)).toBeNull();
});
```

In `apps/mobile/test/meeting-detail.test.tsx`, extend "shows only the back arrow, never the tab group's name":

```tsx
// VoiceOver reads the back button by its title, which iOS otherwise takes from the screen underneath: "(tabs)".
expect(header).toHaveProp("backTitle", "Back");
```

Run `pnpm --filter mobile test edit-tags meeting-detail`. Expected: FAIL; the retry shows the server's words, and the header has no back title.

- [ ] **Step 2: Fix both.** In `useRemoval` (`src/ui/your-tags.tsx`), keep whether the last attempt couldn't be confirmed (import `useRef` from react and `Unreachable` from `@/api/client`):

```tsx
// A removal that timed out may have reached the server, so a retry's "not_tagged" means it worked.
const unconfirmed = useRef(false);
```

In the `catch`, before `notice.tell(...)`:

```tsx
if (error instanceof ApiError && error.code === "not_tagged" && unconfirmed.current) {
  unconfirmed.current = false;
  await forgetMyTags(meetingId).catch(() => undefined);
  onRemoved(null);
  notice.tell("Your tags are removed.");
  setRemoving(false);
  return;
}
unconfirmed.current = error instanceof Unreachable;
```

and set `unconfirmed.current = false;` after a successful removal. In `src/app/_layout.tsx`'s `screenOptions`, under `headerBackButtonDisplayMode: "minimal"`, add `headerBackTitle: "Back",` and extend its comment: "and VoiceOver reads the button by this title, which a deep link would otherwise leave as "(tabs)"."

Run `pnpm --filter mobile test`. Expected: PASS.

- [ ] **Step 3: Docs and commit.**
  - In `docs/standards.md`'s "Tagging a meeting" row, change "`<YourTags meeting onAnswered>`" to "`<YourTags meeting onAnswered notice>` (the page's `useNotice()`, held above the keyed component so a merge's message survives the remount)".
  - Add the three deferred minors to the roadmap's Phase 6 "Later" bullet.

  Then `pnpm check`, and:

```bash
git add apps/mobile docs/standards.md docs/superpowers/plans/2026-09-26-roadmap.md
git commit -m "fix(mobile): a confirmed retry of a removal says so, and VoiceOver's back button says Back"
```

---

## Done when

- `pnpm check`, `pnpm knip:production` and `pnpm --filter web test:e2e` pass, and CI is green (Task 14 Step 1).
- No write writes a device's record: days and counters reach `devices` only through the nightly fold, and no device record sits a transaction id from a tag row (Task 5A).
- Staging and production verify App Attest assertions and registrations. Production also checks DeviceCheck tokens. `REQUIRE_ATTESTATION=on` in both (Tasks 14–15).
- On a real iPhone (TestFlight, staging), registration, every write, "Delete all my tags" and re-registration work with checks on. The iPhone audit passes with `X-Attestation` on every write (Task 14).
- The privacy manifest matches spec §11 and every library's required-reason APIs. App Privacy, age rating (13+), content rights and availability are entered from `docs/app-store.md` (Tasks 10, 15).
- /metrics and coverage.md tell a bot check from a site's own restriction, from one shared classifier, and nothing tries to get past a bot check (Task 12).
- A place with nothing within 16 miles offers "Search farther" (60 miles) once, on the list and the map (Task 13).
- mymeetingapp 1.0.0 is live on the App Store against production, sold by Gooder Software LLC (or as Owner decision needed 1 settles). The website links to it and shows the Smart App Banner (Task 16).
- Owner decisions honoured:
  - recorded: 1 (conversion, no transfer), 2 (iOS first, Phase 6b in the roadmap), 3 (public release, testers on staging until then);
  - needed: 1–5, each answered or following its recommendation.
- Still open, in the roadmap:
  - Phase 6b (Android);
  - DeviceCheck bits for blocked devices;
  - App Attest receipts and the fraud metric;
  - enforcing Apple's authenticator-data extensions;
  - the three deferred 5b minors;
  - connecting mymeetingapp.com (docs/deploy.md has the steps; the listing's URLs then change with a metadata push).

## Self-review

Run against SPEC.md and the brief on 2026-10-02.

**1. Spec and brief coverage.**

| Requirement                                                                                                                                                                                                                  | Task                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `attest_challenges` + nightly purge                                                                                                                                                                                          | 3                                                                                        |
| `POST /attest/challenge`, `/attest/register`                                                                                                                                                                                 | 5                                                                                        |
| Attestation verification: CBOR, Apple root chain, nonce, appId = teamId.bundleId, counter, AAGUID                                                                                                                            | 4 (verifier), 5 (route)                                                                  |
| Assertions on writes via `X-Attestation`                                                                                                                                                                                     | 6                                                                                        |
| Spec §2: no devices row a transaction id from a tag row (xmin review, Option A): the write path reads only `blocked`, `device_days` (2 days), the nightly fold, blocking an unfolded device, the §2 sentence on blocked rows | 5A (and Task 6's counter on `device_days`)                                               |
| DeviceCheck fallback, ES256 `.p8` JWT, secret never printed or committed                                                                                                                                                     | 7, 1 Step 5, 15 Step 2                                                                   |
| `REQUIRE_ATTESTATION` flip; staging vs production                                                                                                                                                                            | 14 Step 8, 15 Step 3, deploy table in 14 Step 9                                          |
| Rate limits and error envelopes                                                                                                                                                                                              | 5 (`attestation` bucket, `rate_limited`), 6/7 (`attestation_failed` 401, `server_error`) |
| App Attest client: key once per install in the Keychain, attestation on first write, assertion on each write                                                                                                                 | 8                                                                                        |
| Expo module research; local module                                                                                                                                                                                           | Finding 3, decision 1, Task 8                                                            |
| Simulator and unsupported cases                                                                                                                                                                                              | 8 (tests: simulator, DeviceCheck, Android, Apple unavailable)                            |
| Network audit: `X-Attestation` required and shape-checked                                                                                                                                                                    | 9                                                                                        |
| Privacy manifest incl. required-reason APIs of deps                                                                                                                                                                          | 10                                                                                       |
| App Privacy label from §13, with a test and a mapping                                                                                                                                                                        | 10 (test + `docs/app-store.md` table)                                                    |
| Age rating; export compliance                                                                                                                                                                                                | 10                                                                                       |
| Listing: name, subtitle ("Recovery meetings near you"), description, keywords, screenshots, support/privacy URLs, category                                                                                                   | 11 (copy, test), 15 Step 4 (screenshots)                                                 |
| Feed errors: bot check vs restriction vs not JSON on /metrics and in discovery; one shared classifier; never past a bot check; recorded fixtures only                                                                        | 12                                                                                       |
| "Search farther": 97 km (60 miles) once, same rounded point, that search only; empty again falls back to online; offline; map zooms to fit                                                                                   | 13                                                                                       |
| Owner decision 1: conversion follow-ups (agreements, seller, EAS credentials, ASC key `ZG2Z6A5JY3`, rename); not blocking release                                                                                            | 1 Step 2, 1 Step 4, 14 Step 5, 16 Step 1, Owner decision needed 1                        |
| Owner decision 2: Phase 6b section                                                                                                                                                                                           | 1 Step 8                                                                                 |
| Owner decision 3: App Review submission, production profile build, release checklist, review notes                                                                                                                           | 10 (notes, checklist), 15, 16                                                            |
| `ascAppId` and team test-pinned                                                                                                                                                                                              | 11                                                                                       |
| Spec §4 politeness: bot checks                                                                                                                                                                                               | 12 (plus `SPEC.md` §4 and the standards)                                                 |
| Spec §7 delete-mine deletes attestation data                                                                                                                                                                                 | 3                                                                                        |
| Spec §8 search radius                                                                                                                                                                                                        | 13 (plus `SPEC.md` §8)                                                                   |
| Spec §9 Smart App Banner once live                                                                                                                                                                                           | 16                                                                                       |
| Spec §13 every table in the inventory                                                                                                                                                                                        | 3                                                                                        |
| Spec §16 legal review, "AA" in metadata (keywords)                                                                                                                                                                           | 1 Step 3, Owner decision needed 4                                                        |
| Optional 5b minors                                                                                                                                                                                                           | 17                                                                                       |

Gaps found and fixed while writing:

- **Missing required-reason APIs.** The first draft of the manifest missed expo-file-system's FileTimestamp `0A2A.1`/`3B52.1` and DiskSpace `E174.1`/`85F4.1`. The scan Task 10's test performs found them, and the manifest now carries them.
- **Store builds reaching testers.** Production builds would have auto-reached staging testers; Task 15 Step 7 now stops it.

Deliberately not covered: spec §6's DeviceCheck bits (decision 8, roadmap).

**2. Placeholder scan.** No "TBD", "TODO", "later" or "similar to Task N". Some values exist only at run time, and each step says where it comes from:

- `<KEYID>`: Task 1 Step 5;
- `<artifact url>`: `eas build:view`;
- build N: EAS's counter;
- `<staging deployment url>`: Step 4's build;
- the store name: Task 1 Step 4.

**3. Type consistency.** Checked across tasks:

- `verifyAttestationObject` / `verifyAssertion` / `sha256` (4 → 5, 6);
- `appAttestConfig` (5 → 6, 7);
- `saveAttestKey` / `registeredKey` / `highestCounter` / `hasAttestKey` (5, 6, 7);
- `deviceDays`, `recordDeviceDay`, `foldDeviceDays` (5A) and `assertFreshCounter`, `DeviceProof`, `WriteDevice.proof` (6);
- `spendChallenge` (named so the React hooks lint rule never mistakes it for a hook);
- `readWriteRequest(req, schema)` returning `{ device, body }`, and `readDeletionRequest` now async (6);
- `parseAttestation` / `appAttestHeader` / `deviceCheckHeader` / `assertionClientData` (2 → 6, 7, 8, 9);
- `HeaderContext.attested` (9);
- the device layer's `integritySupport` / `savedAttestKey` / `rememberAttestKey` / `forgetAttestKey` / `newAttestKey` / `attestKey` / `assertion` / `deviceCheckToken` / `StaleAttestKey` (8);
- `feedProblem` / `feedProblemMessage` / `FeedProblem` and feed type `bot_blocked` (12, in the sync and discovery);
- `WIDER_SEARCH_RADIUS_KM` and `onFarther` (13);
- `BRAND.appStoreId` (16).

**4. Review Focus.** Each of the eight lines has a pinning test in the task named beside it:

| Line | Tests                                                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Task 8 "sends one write at a time"; Task 6 "refuses an assertion whose counter isn't above the last one", "lets a retried write through", "lets only one of two writes signed with the same counter through"                                                    |
| 2    | Task 8 "registers a new key when the saved one no longer works"; Task 5 "a new registration replaces the phone's old key"                                                                                                                                       |
| 3    | Task 3 delete-mine on a blocked phone; Task 8 "registers again after Delete all my tags"                                                                                                                                                                        |
| 4    | Task 6 "accepts a phone clock 23 hours off and refuses one 25 hours off"                                                                                                                                                                                        |
| 5    | Task 8 "sends the write without a proof when Apple can't attest right now"; Task 7 "answers server_error and logs only the status"                                                                                                                              |
| 6    | Task 12 "asks a bot-checked feed once, as itself, and never again in that run"; "records a site behind a … bot check and stops probing it"                                                                                                                      |
| 7    | Task 13 "offline, shows the last search in its place…"; "falls back to the online meetings when 60 miles finds nothing either"                                                                                                                                  |
| 8    | Task 5A "leaves the device's record untouched: neither its xmin nor its xmax moves", "puts no device record within one transaction id of a fresh tag row (spec §2)"; Task 6 "keeps the counter on today's device_days row and never writes the device's record" |

## References

- Apple, "Validating apps that connect to your server": https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server
- Apple, "Attestation object validation guide" (the sample attestation, the expected intermediate values): https://developer.apple.com/documentation/devicecheck/attestation-object-validation-guide
- Apple, "Establishing your app's integrity" (keys don't survive reinstall; `serverUnavailable`): https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity
- Apple, "Preparing to use the App Attest service" (sandbox AAGUID, ramp-up): https://developer.apple.com/documentation/devicecheck/preparing-to-use-the-app-attest-service
- Apple, App Attest environment entitlement: https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.devicecheck.appattest-environment
- Apple, App Attestation Root CA: https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
- Apple, "Accessing and modifying per-device data" (DeviceCheck API, provider token): https://developer.apple.com/documentation/devicecheck/accessing-and-modifying-per-device-data
- Apple, `DCDevice.generateToken`: https://developer.apple.com/documentation/devicecheck/dcdevice/generatetoken(completionhandler:)
- DeviceCheck `validate_device_token` and status codes (summaries): https://ionic.io/docs/tutorials/mobile-security/device-check, https://developerinsider.co/devicecheck-api-unique-identifier-for-the-ios-devices/
- Expo, AppIntegrity (`@expo/app-integrity`, alpha): https://docs.expo.dev/versions/latest/sdk/app-integrity/ and https://expo.dev/blog/expo-app-integrity
- Expo, "Privacy manifests" (`ios.privacyManifests`, static CocoaPods): https://docs.expo.dev/guides/apple-privacy/
- Expo, EAS Metadata schema: https://docs.expo.dev/eas/metadata/schema/
- Apple, "App privacy details on the App Store" (collect, linked, tracking, App Functionality): https://developer.apple.com/app-store/app-privacy-details/
- Apple, App Review Guidelines (1.4.1, 1.4.3, 2.1, 5.1.1, 5.1.5, 5.2.1): https://developer.apple.com/app-store/review/guidelines/
- Apple, Screenshot specifications: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/
- Apple, Age ratings values and definitions: https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions
- 9to5Mac, social media age-rating questions (September 2026): https://9to5mac.com/2026/07/09/apple-adds-social-media-questions-to-app-store-connect-age-rating-questionnaire/
- Apple, App transfer criteria (a released version is required): https://developer.apple.com/help/app-store-connect/transfer-an-app/app-transfer-criteria
- Apple, Remove an app (a bundle ID with an uploaded build can't be reused): https://developer.apple.com/help/app-store-connect/create-an-app-record/remove-an-app
- Apple, Program enrollment (converting an individual membership: contact Apple; D-U-N-S): https://developer.apple.com/help/account/membership/program-enrollment/
- Conversion steps and what changes (third-party guides): https://help.ptminder.com/en/articles/4001125-how-to-convert-an-individual-apple-developer-program-membership-to-an-organization-account, https://support.shopgate.com/en/knowledge/how-to-convert-your-apple-developer-program-from-an-individual-to-an-organization-account
