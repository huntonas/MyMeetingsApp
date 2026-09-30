# The mobile app (apps/mobile)

## Local setup

1. Install Xcode (with the iOS simulator) and, for Android, Android Studio with an emulator.
2. `cp apps/mobile/.env.example apps/mobile/.env`.
3. `pnpm --filter mobile ios` builds and opens the dev build in the simulator; `pnpm --filter mobile start` serves JavaScript to an installed dev build.
