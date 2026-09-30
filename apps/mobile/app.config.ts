import type { ConfigContext, ExpoConfig } from "expo/config";

// The font files ship inside the app, copied at build time from the npm package; nothing is fetched at run time.
const FONTS = "node_modules/@expo-google-fonts/atkinson-hyperlegible";
const REGULAR = `${FONTS}/400Regular/AtkinsonHyperlegible_400Regular.ttf`;
const BOLD = `${FONTS}/700Bold/AtkinsonHyperlegible_700Bold.ttf`;

// BRAND.appName (packages/shared/src/brand.ts); app-shell.test.tsx fails if the two differ.
const APP_NAME = "mymeetingapp";

// The icon art (assets/mark.svg, rendered by `pnpm --filter mobile icons`) sits on ACCENT, the light palette's `accent`
// in src/theme/colors.ts; the mark itself is that palette's `bg`. This file can't import colors.ts, which pulls in
// react-native.
const ACCENT = "#1f5f8b";
const MARK = "./assets/mark.png";

// Read when the config is built, so each build takes the key from its own environment. expo-modules-core widens
// process.env to `any`; the typeof check narrows it back, as in src/config/server-url.ts.
function googleMapsAndroidKey(): string | undefined {
  const key: unknown = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  return typeof key === "string" ? key : undefined;
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // The Expo account the app builds under. This login also belongs to another account, so EAS needs it named.
  owner: "huntonas",
  // Created by `eas init`, which can't write into a dynamic config.
  extra: { eas: { projectId: "14727d21-7124-463d-a886-96e058058e1a" } },
  name: APP_NAME,
  slug: APP_NAME,
  scheme: APP_NAME,
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  // Every build ships its JavaScript inside the app; nothing is downloaded over the air.
  updates: { enabled: false },
  ios: {
    bundleIdentifier: "com.goodersoftware.mymeetingapp",
    supportsTablet: false,
    // HTTPS and the Keychain through the OS only: exempt, so `ITSAppUsesNonExemptEncryption` is false.
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: "com.goodersoftware.mymeetingapp",
    // Spec §11: coarse and fine foreground location only, never background.
    permissions: ["android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"],
    blockedPermissions: ["android.permission.ACCESS_BACKGROUND_LOCATION"],
    adaptiveIcon: { foregroundImage: MARK, monochromeImage: MARK, backgroundColor: ACCENT },
  },
  plugins: [
    "expo-router",
    "expo-sqlite",
    ["expo-splash-screen", { image: MARK, imageWidth: 200, backgroundColor: ACCENT }],
    [
      // Spec §2: While Using only. `false` leaves the Always and motion purpose strings out of the app entirely.
      "expo-location",
      {
        locationWhenInUsePermission: `${APP_NAME} uses your location to sort nearby meetings. It rounds it to about 1 km before searching, and your exact location never leaves your phone.`,
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        motionUsagePermission: false,
      },
    ],
    // Spec §8: Apple Maps on iOS, which needs no key, and Google Maps on Android. The Android key is a build secret
    // (an EAS secret, or exported in the shell for a local build), never committed; without it the Android map is
    // blank.
    ["react-native-maps", { androidGoogleMapsApiKey: googleMapsAndroidKey() }],
    [
      "expo-font",
      {
        ios: { fonts: [REGULAR, BOLD] },
        android: {
          fonts: [
            {
              fontFamily: "AtkinsonHyperlegible",
              fontDefinitions: [
                { path: REGULAR, weight: 400 },
                { path: BOLD, weight: 700 },
              ],
            },
          ],
        },
      },
    ],
  ],
});
