# The mobile app (apps/mobile)

## Local setup

1. Install Xcode (with the iOS simulator) and, for Android, Android Studio with an emulator.
2. `cp apps/mobile/.env.example apps/mobile/.env`. This local `.env` decides where a dev build points: a dev build's JavaScript comes from your Metro, which inlines `EXPO_PUBLIC_SERVER_URL` from it. It says staging; change it to your Mac's LAN address to use `pnpm --filter web dev`. Never production: from 5b, dev builds add and delete tags, and `serverUrl()` throws if a dev build is pointed there. An `eas.json` profile's `env` reaches only a JavaScript bundle built into the app (TestFlight and store builds), so the `development` profile's staging URL is documentation, not protection.
3. `pnpm --filter mobile ios --port 8082` builds and opens the dev build in the simulator (add `--device` for a plugged-in iPhone); `pnpm --filter mobile start --port 8082` serves JavaScript to an installed dev build. Pass a port other than 8081 whenever another project's Metro may be on 8081: a dev build connected to it loads that project's code. To point the simulator's installed dev build at our server, run `xcrun simctl openurl booted "exp+mymeetingapp://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8082"`; on an iPhone, pick the server from the dev launcher. `pnpm --filter mobile android` takes `--port` too.
4. Dev builds float Expo's dev-menu gear over the top-right of the screen, and its touch area covers the Help header button and the top of a meeting's Save heart. That's dev-only: tap slightly lower, or check those in the Release build.
5. The Release build is the realistic one for smoke checks (offline, Save, Help): it carries its own code, with no gear or dev launcher. `pnpm --filter mobile ios --configuration Release` (add `--device` for an iPhone). The command ends with an error because it tries to open the dev launcher, which a Release build doesn't have; the app is already installed and runs.
6. Android maps need `GOOGLE_MAPS_ANDROID_API_KEY` (owner decision 5): an EAS secret for EAS builds, and exported in the shell for `pnpm --filter mobile android`. Without it the Android map is blank; iOS (Apple Maps) needs nothing. Never commit the key.

## Proxy audit

Checklist for reviewing traffic captured from a real device through a debugging proxy. `tools/network-audit`
(`pnpm --filter network-audit check-har`, Task 14's runbook has the full capture-and-run steps) checks all of
this automatically against a HAR capture:

- no Cookie header, and no non-empty `request.cookies` entry (mitmdump records cookies both ways), on any
  request to our server;
- every header a request to our server carries is on a fixed allowlist, each with its own pinned value
  shape — not just an allowed name, since a coordinate or a canary could otherwise ride along in an allowed
  header's value:
  - `Host` equals `--server`;
  - `Accept` is exactly `application/json`;
  - `Content-Type` is exactly `application/json`, and only on a `POST` or `PUT` that carries a body — the
    search `POST`, or one of Phase 5b's writes below that has one;
  - `Content-Length` equals the request's real recorded size (HAR `bodySize`) exactly, and is a finding at all
    when there's no body — except `Content-Length: 0` on a bodiless write (`DELETE /tags/:id`,
    `POST /tags/delete-mine`), which mitmdump's `savehar.py` always adds and which is allowed only there;
  - `Cache-Control` and `Pragma` are exactly `no-cache`;
  - `Accept-Language` is a comma list of at most 6 BCP47-lite tags — language, optional Script, optional
    Region or the UN M49 code `419`, optional `;q=` — e.g. `en-US,en;q=0.9`; a bare numeric-looking "region"
    like `en-86781` is refused;
  - `Accept-Encoding` is a comma list drawn only from `gzip`, `deflate`, `br`, `zstd`, `identity`;
  - `User-Agent` is exactly the app's own shape: iOS `mymeetingapp/<int> CFNetwork/<ver> Darwin/<ver>` (the
    app name comes from `packages/shared/src/brand.ts`, so it can't silently drift from what the app actually
    ships), or Android `okhttp/<major>.<minor>.<patch>` (a single-digit major, matching every real `okhttp`
    release) — critically, the _version_ fields are digits only, not `[\d.]+`, so a coordinate like
    `35.9614` can't hide there the way it could in an earlier, looser regex. Every `User-Agent` value seen
    across the whole capture is also listed in the report for a human to confirm, and more than one distinct
    value is itself a finding: the app sends exactly one;
  - `Connection` is `keep-alive` or `close`;
  - `Priority` matches RFC 9218 (e.g. `u=3, i`, which recent iOS sends on every request);
  - `X-Device-Id`, `X-Platform`, `X-App-Version` (spec §7) are a finding on any read ("sends the device
    header ..."), and required on every write, each held to the server's own shape
    (`WriteHeaders.shape.deviceId`/`.platform`/`.appVersion`): a 16-64 character id of letters, digits and
    hyphens, `ios` or `android`, and a `1.2.3`-style version. A capture that carries more than one distinct
    `X-Device-Id` value is itself a finding ("sends more than one device ID") — the id itself is never
    printed, there or anywhere else in the report. `X-Attestation` is a finding on every write until Phase 6
    turns it on ("sends X-Attestation, which isn't switched on yet");
  - `If-None-Match`/`If-Modified-Since` are allowed only on a GET read, and only when the value exactly
    equals an `etag`/`Last-Modified` that an **earlier response to that same URL, in this same capture**
    actually returned — never an arbitrary value. Vercel's ETags are a hash of the response body, shared by
    every client that sees the same response, not a per-person identifier — confirm this on the first real
    capture by comparing the ETag for the same read across two different phones; it must be identical. (A
    fresh capture's _first_ read of a URL can't legitimately carry either header yet, since there's nothing
    earlier in the capture to echo — background/foreground the app, or repeat a search, so a second read of
    the same URL appears and can carry one.)

  An HTTP/2 pseudo-header (`:method`, `:path`, ...) is never allowed at all: mitmdump's HAR writer never
  records these, so one appearing means the capture didn't come from mitmdump, or was tampered with. Any
  other header name, or an allowed header with a value outside its shape, is a finding;

- the capture includes at least one real `POST /meetings/search`; an empty capture, or one checked against the
  wrong `--server`, is itself a finding, not a pass, since it hasn't proven anything about search traffic;
- our own hostname reached over a scheme or port `--server` didn't declare (e.g. plain `http://` where `https`
  was expected) is its own finding ("our server reached a different way"), never silently counted as a
  third-party host;
- the search body must match `JSON.stringify(MeetingSearchRequest.parse(request))` byte-for-byte, not just
  parse to valid values — a duplicate JSON key or a number with far more precision than a double can hold can
  still parse to a valid rounded value while the raw bytes on the wire weren't what the app would ever send.
  This is also why coordinates written in scientific/exponential notation (e.g. `3.596e1`) have no path
  through our own server undetected: `JSON.stringify` never re-emits a number that way, so the byte-for-byte
  comparison already catches it without needing to specifically look for that notation;
- **Writes** (Phase 5b, spec §7): each of the app's five writes is held to the same byte-exact standard as
  search — `JSON.stringify` of its own contract's `parse`, or no body at all — and every device header above:
  - `POST /tags` — `TagSubmissionRequest` (`meetingId`, `tags`, optional `nearMeeting`);
  - `PUT /tags/:id` — `TagEditRequest` (`tags`);
  - `DELETE /tags/:id` — no body;
  - `POST /tags/delete-mine` — no body;
  - `POST /suggestions` — `SuggestionRequest` (`text`).

  A missing device header is its own finding ("write without the x-device-id header", and so on); a body that
  doesn't match its contract byte-for-byte is "write body isn't exactly what the app sends"; a body on a write
  whose contract has none is "sends a body on a write that has none" — checked as `bodyText(request) !== ""`,
  or a non-empty HAR `params`, or `bodySize > 0`, not just whether `postData` exists, since `savehar.py` always
  writes an empty `postData` for a bodiless POST and a plain existence check would fail every real delete-mine
  capture. Any other method or path reaching our server — not a read, the search, or one of these five — is
  "isn't one of the app's requests".

The exact point's first three decimals fail the run on any host when written with a dot or a decimal comma
(`36.162`, `36,162`). With the dot stripped (`36162`) they fail only on our own server: elsewhere those digits
collide with timestamps and ids, so they go under "Look at these" instead.

The tool's output can also print a "Look at these" section: coordinate-looking number pairs sent to another
host, an exact point's digits without the dot sent to another host, and plain `http://` to a host that isn't private or loopback (including the IPv6 loopback/unique-local/
link-local ranges, and IPv4 link-local `169.254.x.x`). These are informational only and never fail the run —
a map SDK legitimately sends tile coordinates to its own host, and a local dev capture legitimately uses
plain http — but are worth a human glance.

**Known limits** (accepted, not planned): a canary split across two separate parts of a request can't be
caught by substring matching; a canary base64-encoded _inside_ a third-party JSON body (as opposed to a HAR
`postData.encoding` of `base64`, which the tool does decode) isn't unwrapped; and coordinates written in
degrees-minutes-seconds or scientific/exponential notation sent to a **third party** aren't specifically
searched for as a pattern (a map SDK's tile traffic would make that list too noisy to be worth reading) — only
traffic to our own server is held to an exact shape.

## TestFlight builds

Full detail: `docs/superpowers/plans/2026-09-30-staging-and-testflight.md`.

- The `testflight` profile in `apps/mobile/eas.json` builds against staging (`EXPO_PUBLIC_SERVER_URL=https://mymeetingapp-staging.vercel.app`), so a TestFlight tester's phone never reaches production. The `production` profile is the same build pointed at `https://mymeetingapp.vercel.app`, for later store submissions.
- Build numbers come from EAS, not the repo: `appVersionSource: "remote"` and `autoIncrement: true` mean each build gets the next number automatically, and no `buildNumber` is tracked in `app.config.ts`. The version shown in TestFlight and on the device is `app.config.ts`'s `version`.
- The icon, adaptive icon and splash all render from one file. After editing `apps/mobile/assets/mark.svg`, re-render the PNGs with `pnpm --filter mobile icons` and commit them along with the SVG.

### Building and submitting a TestFlight build (Owner)

Needs an Apple ID and 2FA, so the owner runs these, not Claude.

1. Confirm the Apple Developer Program membership for Gooder Software LLC is active, and that the latest agreements are accepted in App Store Connect → Business.
2. Build:
   ```bash
   cd apps/mobile && pnpm dlx eas-cli@24.8.0 build --platform ios --profile testflight
   ```
   Sign in to Apple when asked, pick the Gooder Software LLC team, and let EAS register `com.goodersoftware.mymeetingapp` and create the distribution certificate and App Store provisioning profile. If EAS asks to upgrade the plan or buy builds, that's the owner's call.
3. Submit:
   ```bash
   pnpm dlx eas-cli@24.8.0 submit --platform ios --latest
   ```
   EAS creates the App Store Connect record on this first submission.
   - If the name `mymeetingapp` is already taken on the App Store, create the record by hand instead (App Store Connect → Apps → + → New App, bundle ID `com.goodersoftware.mymeetingapp`, another name), then rerun `submit` and give it the `ascAppId` it asks for. Claude then adds `"submit": { "testflight": { "ios": { "ascAppId": "<id>" } } }` to `eas.json` (not secret) and commits it.
4. In App Store Connect → TestFlight, wait for processing (10–15 minutes). There should be no "Missing Compliance" (the app already answers export compliance in `app.config.ts`). Create the internal testing group, add testers, install the build through the TestFlight app, and search "Maryville, TN".
5. Confirm the requests reached staging, not production: Vercel → Logs, filtered to the staging environment, should show `POST /api/v1/meetings/search` from around that time, and production should show none from that phone then.
