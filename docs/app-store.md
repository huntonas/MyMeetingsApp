# The App Store: what's entered by hand

The listing itself (name "My Meeting App: Meeting Finder", subtitle "Recovery meetings near you", description, keywords, URLs, categories, copyright, release) lives in `apps/mobile/store.config.json` (created in Phase 6 Task 11) and is pushed with `eas metadata:push`. Everything here is entered in App Store Connect by the owner, because the API doesn't cover it or it holds the owner's phone number.

## App Privacy

App Store Connect → the app → App Privacy → "Get Started".

- "Do you or your third-party partners collect data from this app?" → **Yes**.
- Choose exactly these three, and nothing else:

| Data type (Apple)                     | Spec §11                                        | §13 rows it covers                                                                                                                                                                                                                                                                                                                                                   | Usage                                                                                        | Linked to the user? | Tracking? |
| ------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------- | --------- |
| Location → **Coarse Location**        | Coarse Location (app functionality)             | Search request (rounded to ~1 km, used for one query, not stored); `tag_submissions.near_meeting` (the attendance check's yes or no: the phone was within 200–500 m of a known meeting address at its time; kept until the tags are changed or removed)                                                                                                              | App Functionality                                                                            | No                  | No        |
| Identifiers → **Device ID**           | Device ID (app functionality, fraud prevention) | `devices` (keyed hash, App Attest key), `tag_submissions.submitter_id` (a per-meeting ID derived from the phone's ID, kept until the tags are changed or removed), `device_days` (2 days), `devicecheck_tokens` (SHA-256 of used DeviceCheck tokens, linked to nothing, 2 days), `rate_limits` (2 days), `tag_audit` (7 days), `suggestions` (device link ≤ 30 days) | App Functionality (Apple's definition includes "prevent fraud, implement security measures") | No                  | No        |
| User Content → **Other User Content** | Other User Content (tags, suggestions)          | `tag_submissions` (until changed or removed; they count for as long as they stand), `tag_counts`, `suggestions`, `ai_decisions`                                                                                                                                                                                                                                      | App Functionality                                                                            | No                  | No        |

Not declared, and why:

- **Precise Location:** the exact position stays on the phone (§13); the attendance check sends only yes or no.
- **User ID:** there are no accounts. The phone's random ID is a Device ID, stored only as a keyed hash.
- **Health & Fitness:** the sobriety date stays on the phone.
- **Contact Info:** support email is sent from the person's own mail app, outside this app.
- **Crash Data, Performance Data, Product Interaction:** none collected; no analytics SDK.
- **IP address:** not a data type of its own. Vercel's request logs aren't used to derive location.

Coarse Location is declared (spec §11; owner decision, 2026-10-02) because it is collected: the search point is used for one query and dropped, but the stored near-meeting yes or no places the phone within 200–500 m of a known address at a known time. That is coarser than Apple's Precise Location threshold (three decimal places, about 100 m).

The privacy manifest's `NSPrivacyCollectedDataTypes` in `apps/mobile/app.config.ts` declares the same three, and `privacy-manifest.test.ts` holds them to SPEC.md.

react-native-maps' own `PrivacyInfo.xcprivacy` declares Precise Location as collected, but it isn't in the build: the default `Maps` subspec (Apple Maps), the one the app uses, bundles no resources, so that file never ships. (The Google Maps subspec bundles Google's own privacy file; the iOS app doesn't use it.) If Xcode's privacy report or a reviewer raises it, that's why it isn't declared.

## Age rating

App Store Connect → App Information → Age Rating → Edit. Answer:

| Question                                                                                                                 | Answer                                 | Why                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cartoon or Fantasy Violence, Realistic Violence, Prolonged Graphic or Sadistic Realistic Violence, Guns or Other Weapons | None                                   |                                                                                                                                                                                  |
| Profanity or Crude Humor, Horror/Fear Themes                                                                             | None                                   |                                                                                                                                                                                  |
| **Alcohol, Tobacco, or Drug Use or References**                                                                          | **Infrequent**                         | Spec §11: "alcohol references apply". AA meetings and recovery are named; nothing encourages drinking (guideline 1.4.3)                                                          |
| Mature or Suggestive Themes, Sexual Content or Nudity, Graphic Sexual Content and Nudity                                 | None                                   |                                                                                                                                                                                  |
| **Medical or Treatment Information**                                                                                     | **Infrequent**                         | The Help screen gives the SAMHSA National Helpline (treatment referral) and 988                                                                                                  |
| **Health or Wellness Topics**                                                                                            | **Yes**                                | Sobriety counter, recovery meetings                                                                                                                                              |
| Unrestricted Web Access                                                                                                  | No                                     | Links open Safari, Maps or the phone app; there is no in-app browser                                                                                                             |
| User-Generated Content                                                                                                   | No                                     | Tags come from a fixed list of neutral words (26 at launch); suggested words are screened and reviewed before anyone else sees them; there is no free text, profile or messaging |
| Social Media, Messaging and Chat, Advertising, Age Assurance, Parental Controls                                          | No                                     |                                                                                                                                                                                  |
| Gambling, Loot Boxes                                                                                                     | No; Simulated Gambling, Contests: None |                                                                                                                                                                                  |

Expected rating: **13+** (Infrequent alcohol references set 13+; nothing sets 16+).

## Export compliance

Already answered in the build: `ITSAppUsesNonExemptEncryption` is false (`app.config.ts`, `usesNonExemptEncryption: false`). The app uses only Apple's own encryption (HTTPS, the Keychain, App Attest), which is exempt. App Store Connect asks nothing.

## Content rights

App Information → Content Rights: "Does your app contain, show, or access third-party content?" → **Yes**, and "I have the necessary rights". Meeting listings are public data published by AA service entities in the open Meeting Guide format, used under the good-citizen rules of spec §4.

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
Thank you for reviewing My Meeting App.

Nothing to sign into: the app has no accounts, so there is no demo account. Everything works from the first launch.

Finding meetings: type "Maryville, TN" in the search box and choose Search, or tap "Use my location". The app never asks for location when it opens.

How the app uses location:
- Nearby meetings: the phone rounds its location to about 1 km (two decimal places) and sends only that rounded point to our server, in the body of the search request. The server uses it for that one search and doesn't keep it.
- The attendance check: it runs on the phone, only while the app is open, never in the background. It compares the phone's position with the meeting's address on the phone itself and sends only a yes or no ("near the meeting") with the tags; the exact location never leaves the phone. Opening a meeting's page during its time runs it silently, and only if precise location is already allowed. Tapping "Check I'm near the meeting" while adding tags may ask for location permission and, if only approximate location is allowed, iOS asks once for temporary precise location, with our explanation.

No accounts, by design: the app makes a random ID, kept in the iPhone's Keychain on that phone only. It's sent only with writes (adding, changing or removing tags, suggesting a tag, "Delete all my tags", and the app check described next), never with searches. Our server stores only a keyed hash of it. The sobriety date, saved meetings and the list of tagged meetings never leave the phone.

App Attest and DeviceCheck: so that only the real app can write, the app makes an App Attest key, has Apple attest it, and signs every write with it. The app check runs when the app first writes, and again only when it needs a new key (after a reinstall, or when the server refuses a stale key). Where App Attest isn't offered (every supported iPhone has it; it's missing for an iPhone app running on a Mac, and Mac availability is off), each write carries a one-time DeviceCheck token instead, which our server checks with Apple; we keep only a SHA-256 fingerprint of each used token, linked to nothing, for 2 days so it can't be reused.

Trying tags: tags can be added from a meeting's start until 36 hours after it, by people who went. To try it, search "Maryville, TN", open Filters, choose Morning under Time of day, and open a meeting that started earlier today. Choose "Tag this meeting", pick a few words, and choose "Send my tags". Please then choose "Remove my tags", so test tags don't stay on a real meeting. The Me tab's "Delete all my tags" removes everything this phone added.

User content: tags are chosen from a fixed list of neutral words (26 at launch). People can suggest a new word; we screen and review each suggestion before anyone else sees it. There is no free text, profile, messaging or rating.

Health and safety: this is a meeting finder, not a medical or treatment app, and it gives no medical advice. Every screen has a Help button with the 988 Suicide & Crisis Lifeline and the SAMHSA National Helpline. My Meeting App is not affiliated with or endorsed by Alcoholics Anonymous or A.A. World Services; meeting listings come from public lists that local AA offices publish in the open Meeting Guide format.

Publisher: Gooder Software LLC. Contact: admin@goodersoftwarellc.com.
```

## Release checklist

Phase 6 plan Tasks 15 and 16 run this. Each line is checked before "Submit for Review", then before "Release This Version".

- [ ] Production: `REQUIRE_ATTESTATION=on`, the Apple variables set, the DeviceCheck credential check answered `attestation_failed` (not `server_error`).
- [ ] Production `/api/v1/config` sets no minimum version above 1.0.0; feeds healthy on `/metrics`.
- [ ] Vercel Firewall rules on `/api/v1/attest/` and `/metrics` exist.
- [ ] Neon's production restore window is recorded and is 30 days or less.
- [ ] The privacy policy and terms are live as written, with no draft notice (owner decision, 2026-10-02).
- [ ] The production build is in no tester group but "Release check"; the owner searched with it and saw `POST /api/v1/meetings/search` in production's logs.
- [ ] The production `.ipa` holds the privacy manifest above, the App Attest entitlement, and no Always-location or background key.
- [ ] `eas metadata:push` succeeded; screenshots (6.9", 5 images) uploaded; App Privacy, age rating, content rights, pricing and availability entered as above.
- [ ] No ITMS-91053 "Missing API declaration" email after the upload. The test covers only libraries that ship a manifest; expo-sqlite, expo-secure-store, expo-location, expo-dev-client and datetimepicker ship none.
- [ ] Version release: "Manually release this version".
- [ ] Before releasing: the conversion is finished and the seller shows Gooder Software LLC (owner decision needed 1). If it isn't finished when Apple approves, the build waits in Pending Developer Release until it is.
