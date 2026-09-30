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

- no Cookie header on any `/api` request;
- every header a request to our server carries is one expo/fetch (or the OS network stack beneath it) adds on
  its own to a plain GET/POST JSON request: `Accept`, `Accept-Encoding`, `Accept-Language`, `User-Agent`,
  `Content-Type`, `Content-Length`, `Host`, `Connection`, `Cache-Control`, `Pragma`, and the HTTP/2
  pseudo-headers (`:method`, `:path`, `:authority`, `:scheme`). Any other header name — a device header, a
  custom debug header, anything else — is a finding, whatever it carries;
- the capture includes at least one real `POST /meetings/search`; an empty capture, or one checked against the
  wrong `--server`, is itself a finding, not a pass, since it hasn't proven anything about search traffic.
