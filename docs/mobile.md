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
- every header a request to our server carries is on a fixed allowlist, each with its own pinned value shape —
  not just an allowed name, since a coordinate or a canary could otherwise ride along in an allowed header's
  value: `Accept` (`application/json`), `Accept-Encoding`/`Accept-Language` (comma lists of tokens/language
  tags), `User-Agent` (iOS's `… CFNetwork/… Darwin/…` or Android's `okhttp/…` shape), `Content-Type`
  (`application/json`, POST only), `Content-Length` (digits), `Host` (equals `--server`), `Connection`
  (`keep-alive` or `close`), `Cache-Control`/`Pragma` (`no-cache`), and `Priority` (RFC 9218, e.g. `u=3, i`,
  which recent iOS sends on every request). `If-None-Match`/`If-Modified-Since` are allowed too, but only
  alongside a GET read: Vercel's ETags are a hash of the response body, shared by every client that sees the
  same response, not a per-person identifier — confirm this on the first real capture by comparing the ETag
  for the same read across two different phones; it must be identical. An HTTP/2 pseudo-header (`:method`,
  `:path`, ...) is never allowed at all: mitmdump's HAR writer never records these, so one appearing means the
  capture didn't come from mitmdump, or was tampered with. Any other header name, or an allowed header with a
  value outside its shape, is a finding;
- the capture includes at least one real `POST /meetings/search`; an empty capture, or one checked against the
  wrong `--server`, is itself a finding, not a pass, since it hasn't proven anything about search traffic;
- our own hostname reached over a scheme or port `--server` didn't declare (e.g. plain `http://` where `https`
  was expected) is its own finding ("our server reached a different way"), never silently counted as a
  third-party host;
- the search body must match `JSON.stringify(MeetingSearchRequest.parse(request))` byte-for-byte, not just
  parse to valid values — a duplicate JSON key or a number with far more precision than a double can hold can
  still parse to a valid rounded value while the raw bytes on the wire weren't what the app would ever send.

The tool's output can also print a "Look at these" section: coordinate-looking number pairs sent to another
host, and plain `http://` to a host that isn't private or loopback. These are informational only and never
fail the run — a map SDK legitimately sends tile coordinates to its own host, and a local dev capture
legitimately uses plain http — but are worth a human glance.

**Known limits** (accepted, not planned): a canary split across two separate parts of a request can't be
caught by substring matching; a canary base64-encoded _inside_ a third-party JSON body (as opposed to a HAR
`postData.encoding` of `base64`, which the tool does decode) isn't unwrapped; and coordinates written in
degrees-minutes-seconds or scientific/exponential notation aren't specifically searched for when they're sent
to a third party (only to our own server, where the search body's strict shape check already rejects anything
that isn't a plain rounded decimal).
