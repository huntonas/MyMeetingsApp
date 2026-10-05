# Google Play: what's entered by hand

The Android app ships in Phase 6b. This page holds what the Play Console asks for, so the owner can enter it then. Nothing here is pushed by a tool, and nothing has been sent to Google yet.

## Store listing

Play Console → the app → Grow → Store presence → Main store listing.

| Field                                | Value                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| App name, short and full description | `apps/mobile/store/google-play/listing.json` (`title`, `shortDescription`, `fullDescription`)                                        |
| Default language                     | English (United States), en-US                                                                                                       |
| App icon                             | `apps/mobile/store/google-play/icon.png` (512 × 512 PNG)                                                                             |
| Feature graphic                      | `apps/mobile/store/google-play/feature-graphic.png` (1024 × 500 PNG, no alpha)                                                       |
| Phone screenshots                    | Not yet: see [Screenshots](#screenshots)                                                                                             |
| App category                         | App, **Lifestyle** (the App Store's primary category too)                                                                            |
| Tags                                 | Up to five from the list Play offers for Lifestyle, chosen for meeting finding and recovery; none that claim a feature the app lacks |
| Contact email                        | `admin@goodersoftwarellc.com`                                                                                                        |
| Website                              | `https://mymeetings.app`                                                                                                             |
| Privacy policy                       | `https://mymeetings.app/privacy` (App content → Privacy policy)                                                                      |
| Price and countries                  | Free; the United States only (the meeting data covers the US)                                                                        |

Copy the three texts from `listing.json` exactly. `apps/mobile/test/play-listing.test.ts` holds them to Play's limits (title 30 characters, short description 80, full description 4000), keeps "AA" out of the title and short description (spec §11), keeps them free of emoji, capitals and promotional words (Play's metadata policy), keeps the full description plain text (Play shows HTML and Markdown as raw characters), and checks the same claims as the App Store description (`apps/mobile/test/listing-claims.ts`).

The icon and the feature graphic render from `apps/mobile/assets/mark.svg` and `apps/mobile/assets/feature-graphic.svg` with `pnpm --filter mobile icons`. Commit the PNGs with any change to the SVGs.

## Data safety

Play Console → App content → Data safety. Derived from SPEC.md §13 (the stored-data table and "Stays on the phone") and `apps/web/src/content/privacy-inventory.ts`, plus Google's own notes for the Maps SDK for Android and the Play Integrity API. When in doubt, declare: over-disclosure is safe, under-disclosure isn't.

### Overview

| Question                                                              | Answer  | Why                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does your app collect or share any of the required user data types?   | **Yes** | The rows below                                                                                                                                                                                                                                            |
| Is all of the user data collected by your app encrypted in transit?   | **Yes** | The app talks to our server only over HTTPS; Google's SDKs use TLS                                                                                                                                                                                        |
| Which ways can users sign in?                                         | None    | No accounts (spec §2). Play then asks for no account-deletion web link                                                                                                                                                                                    |
| Do you provide a way for users to request that their data is deleted? | **Yes** | The Me tab's **"Delete all my tags"** (`POST /api/v1/tags/delete-mine`, spec §7): every tag, still-linked suggestion with its AI decisions, rate-limit, `device_days`, audit and attestation row for the phone, and its `devices` row unless it's blocked |

What "Delete all my tags" leaves, as the privacy policy says: a blocked phone's record (spec §6); suggestion text already reviewed (no longer linked to the phone); tag counts already recomputed without it; Neon's restore history up to its window (spec §9); Vercel's request logs (spec §13); and anything Google's SDKs hold under their own retention.

### Data types

Every type below: **Collected: yes. Shared: no**, except the Maps SDK's crash logs, diagnostics and app interactions, which are **shared with Google** (below). Our host (Vercel), database (Neon) and suggestion screening act for us, and Google's Maps SDK and Play Integrity are libraries in the app, which Play counts as collection by the app. Not sold, never used for advertising or marketing, and no tracking.

| Play data type                                             | Collected by                                                                                                           | SPEC §13 rows                                                                                                                                     | Ephemeral?                                       | Required or optional                                                                                               | Purposes                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Location → **Approximate location**                        | The app                                                                                                                | Search request (rounded lat/lng, ~1 km, not stored)                                                                                               | **No** (the near-meeting answer below is stored) | Optional (search by place instead)                                                                                 | App functionality                                    |
| Location → **Precise location**                            | The app                                                                                                                | Search request; `tag_submissions.near_meeting` (yes or no: within 200–500 m of a known meeting address at its time, kept until the tags change)   | No                                               | Optional (location and the attendance check are never required)                                                    | App functionality; Fraud prevention, security        |
| App activity → **Other user-generated content**            | The app                                                                                                                | `tag_submissions`, `tag_counts`, `suggestions`, `ai_decisions`                                                                                    | No                                               | Optional (tagging and suggesting are never required)                                                               | App functionality                                    |
| App activity → **App interactions**                        | Maps SDK for Android (map pan and zoom events)                                                                         | Not ours; Google's Maps SDK notes                                                                                                                 | No                                               | Required (the SDK runs whenever the map shows)                                                                     | App functionality; Analytics (Google's, for the SDK) |
| App info and performance → **Crash logs**, **Diagnostics** | Maps SDK for Android (stack traces, device metadata: OS version, model, SDK version)                                   | Not ours; the app has no analytics or crash SDK                                                                                                   | No                                               | Required                                                                                                           | Analytics (Google's, for the SDK)                    |
| Device or other IDs → **Device or other IDs**              | The app (`ANDROID_ID` with writes); Play Integrity (device attestation); Maps SDK (pseudonymous daily-user identifier) | `devices` (keyed hash), `device_days`, `tag_submissions.submitter_id`, `rate_limits`, `tag_audit` (7 days), `suggestions` (device link ≤ 30 days) | No                                               | Optional for the app's ID (sent only with tags, suggestions and "Delete all my tags"); required for the Maps SDK's | App functionality; Fraud prevention, security        |

Precise location is declared although SPEC §11 lists only approximate. Play defines approximate location as an area of at least 3 km² and precise as anything smaller. The search point is rounded to two decimal places, about 1.1 × 0.9 km in the US, so about 1 km², and the near-meeting answer places the phone within 500 m of a known address at a known time. Both fall under Play's "precise", even though Apple's threshold (about 100 m) makes the same data coarse. Confirmed by the owner on 2026-10-04; SPEC §11 lists it.

Not declared, and why:

- **Personal info** (name, email, phone, address, user IDs): no accounts. Email to support is sent from the person's own mail app, not this app (SPEC §13, "Support email").
- **Health and fitness:** the sobriety date stays on the phone (SPEC §13, "Stays on the phone"). Tags describe a meeting, not the person.
- **Messages, photos and videos, audio, files and docs, calendar, contacts, financial info, web browsing:** none.
- **App activity → in-app search history:** the search box text and recent searches stay on the phone; Android's geocoder (Google's, or on some phones the maker's) turns the text into a point, outside our server.
- **IP address:** Vercel's request logs (SPEC §13) hold it for a short time; it's never used to infer location, so it adds no data type.
- **Advertising ID:** never read. Check in Phase 6b that the merged manifest has no `com.google.android.gms.permission.AD_ID`, and answer the Advertising ID declaration "No".

Play Integrity (Google's notes) also receives the `requestHash` the app sends, the app's package, version and signing certificate, and Google's device attestation; Google doesn't pass it to third parties. It's covered by Device or other IDs above. If the app ever opts in to Play Integrity's environment details, add App activity → Other actions and revisit this page.

The Maps SDK's crash logs, diagnostics and map interactions also help Google improve the SDK. Google's notes leave it to the developer whether that is sharing; this page takes the cautious reading (owner, 2026-10-04): mark those three as **shared** with Google, purpose Analytics. Nothing else here changes.

## Content rating (IARC)

Play Console → App content → Content rating → Start questionnaire. Email: `admin@goodersoftwarellc.com`. Category: **Reference, News, or Educational** (a directory of meetings; it asks about drug and alcohol references, which apply).

| Question                                                           | Answer                   | Why                                                                                                         |
| ------------------------------------------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Violence, blood, gore                                              | No                       |                                                                                                             |
| Sexuality, nudity, sexual content                                  | No                       |                                                                                                             |
| Language (profanity, crude humor)                                  | No                       | Tags are a fixed list of neutral words; suggestions are screened and reviewed before anyone sees them       |
| Fear, horror                                                       | No                       |                                                                                                             |
| **Controlled substances: references to alcohol, tobacco or drugs** | **Yes, references only** | Spec §11: "alcohol references apply". AA and recovery are named; no depiction of use, nothing encourages it |
| Depicts or encourages use of alcohol, tobacco or drugs             | No                       |                                                                                                             |
| Gambling, simulated gambling, real-money contests                  | No                       |                                                                                                             |
| Users can interact or exchange content with each other             | No                       | No messaging, profiles or free text; tags are counted words from a fixed list (as the App Store's "No")     |
| Shares the user's current physical location with other users       | No                       | Only a yes or no, folded into a count, and never shown as a person's                                        |
| Allows users to purchase digital goods                             | No                       | Free, no in-app purchases                                                                                   |
| Unrestricted internet access (a web browser or search engine)      | No                       | Links open the browser, Maps or the phone app                                                               |
| Contains ads                                                       | No                       |                                                                                                             |

Expected: a teen rating in most regions (ESRB Teen, PEGI 12 or similar), in line with the App Store's 13+. IARC sets each region's rating itself; record the certificate it emails.

Other App content declarations, in the same section: Ads, **No**. Target audience, **13–15, 16–17 and 18 and over** (as the App Store's 13+; no under-13 group, so the Families policy doesn't apply), and the app isn't designed to appeal to children. News app, No. Government app, No. Financial features, None. Health apps: answer for the sobriety counter and the 988 and SAMHSA help lines as Play's list then describes them (likely "Addiction" or "Mental and behavioral health" support, with no medical claims), and say it isn't a medical device. Location permission: foreground only (`ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`, background blocked), so there is no background-location declaration.

## Screenshots

Play needs 2 to 8 phone screenshots, 9:16 (portrait) and at least 1080 px on the short side for the "recommended" badge. Take them in Phase 6b from the Android build, on a recent Pixel or the emulator, showing the same five screens as the App Store (Nearby, Map, a meeting, the tag picker, Me). Don't reuse the iOS screenshots in `apps/mobile/store/screenshots/`: they show iOS chrome and Apple Maps, which Play's policy treats as misleading on an Android listing.

## Left for Phase 6b

- The Play Console organization account for Gooder Software LLC (D-U-N-S, verification) and the app's record, package `com.goodersoftware.mymeetingapp`.
- Play App Signing, and its SHA-1 on the Maps key (`GOOGLE_MAPS_ANDROID_API_KEY`).
- Play Integrity: link the Google Cloud project, the credentials secret, the server verifier behind `REQUIRE_ATTESTATION`, and the integrity declaration in the Console; then recheck the Data safety answers against Google's notes at that time.
- The Android device pass deferred from 5b: emulator smoke, the Android proxy audit, keyboard insets.
- The phone screenshots above.
- Enter this page's store listing, Data safety, content rating and App content answers; then the Policy status page must show nothing outstanding.
- Internal testing against staging, then a closed test if Play requires one for a new organization account, then production, with a staged rollout.
