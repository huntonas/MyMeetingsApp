# The mobile app (apps/mobile)

## Local setup

1. Install Xcode (with the iOS simulator) and, for Android, Android Studio with an emulator.
2. `cp apps/mobile/.env.example apps/mobile/.env`.
3. `pnpm --filter mobile ios` builds and opens the dev build in the simulator; `pnpm --filter mobile start` serves JavaScript to an installed dev build.
4. Android maps need `GOOGLE_MAPS_ANDROID_API_KEY` (owner decision 5): an EAS secret for EAS builds, and exported in the shell for `pnpm --filter mobile android`. Without it the Android map is blank; iOS (Apple Maps) needs nothing. Never commit the key.

## Proxy audit

Checklist for reviewing traffic captured from a real device through a debugging proxy:

- no Cookie header on any `/api` request
