# The mobile app (apps/mobile)

## Local setup

1. Install Xcode (with the iOS simulator) and, for Android, Android Studio with an emulator.
2. `cp apps/mobile/.env.example apps/mobile/.env`.
3. `pnpm --filter mobile ios` builds and opens the dev build in the simulator; `pnpm --filter mobile start` serves JavaScript to an installed dev build.
4. Android maps need `GOOGLE_MAPS_ANDROID_API_KEY` (owner decision 5): an EAS secret for EAS builds, and exported in the shell for `pnpm --filter mobile android`. Without it the Android map is blank; iOS (Apple Maps) needs nothing. Never commit the key.

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
  - `Content-Type` is exactly `application/json`, and only on the search `POST`;
  - `Content-Length` equals the request's real recorded size (HAR `bodySize`) exactly, and is a finding at all
    when there's no body;
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
  comparison already catches it without needing to specifically look for that notation.

The tool's output can also print a "Look at these" section: coordinate-looking number pairs sent to another
host, and plain `http://` to a host that isn't private or loopback (including the IPv6 loopback/unique-local/
link-local ranges, and IPv4 link-local `169.254.x.x`). These are informational only and never fail the run —
a map SDK legitimately sends tile coordinates to its own host, and a local dev capture legitimately uses
plain http — but are worth a human glance.

**Known limits** (accepted, not planned): a canary split across two separate parts of a request can't be
caught by substring matching; a canary base64-encoded _inside_ a third-party JSON body (as opposed to a HAR
`postData.encoding` of `base64`, which the tool does decode) isn't unwrapped; and coordinates written in
degrees-minutes-seconds or scientific/exponential notation sent to a **third party** aren't specifically
searched for as a pattern (a map SDK's tile traffic would make that list too noisy to be worth reading) — only
traffic to our own server is held to an exact shape.
