import type { ConfigContext, ExpoConfig } from "expo/config";
import { AndroidConfig, withStringsXml } from "expo/config-plugins";

// The font files ship inside the app, copied at build time from the npm package; nothing is fetched at run time.
const FONTS = "node_modules/@expo-google-fonts/atkinson-hyperlegible";
const REGULAR = `${FONTS}/400Regular/AtkinsonHyperlegible_400Regular.ttf`;
const BOLD = `${FONTS}/700Bold/AtkinsonHyperlegible_700Bold.ttf`;

// BRAND.slug and BRAND.name (packages/shared/src/brand.ts); app-shell.test.tsx fails if they differ. Expo's `name`
// stays the slug: it also names the Xcode project and the executable, which iOS puts at the front of the app's
// User-Agent (the network audit pins it). Only the name under the icon is the display name.
const APP_SLUG = "mymeetingapp";
const DISPLAY_NAME = "My Meeting App";

// The icon art (assets/mark.svg, rendered by `pnpm --filter mobile icons`) sits on ACCENT, the light palette's `accent`
// in src/theme/colors.ts; the mark itself is that palette's `bg`. This file can't import colors.ts, which pulls in
// react-native.
const ACCENT = "#1f5f8b";
const MARK = "./assets/mark.png";

// Android's launcher label is the `app_name` string, which Expo fills from `name` and offers no separate setting for;
// this sets it to the display name. Plugins in this file run their changes after Expo's own, so this one wins.
function withLauncherLabel(config: ExpoConfig): ExpoConfig {
  return withStringsXml(config, (mod) => {
    mod.modResults = AndroidConfig.Strings.setStringItem(
      [AndroidConfig.Resources.buildResourceItem({ name: "app_name", value: DISPLAY_NAME })],
      mod.modResults,
    );
    return mod;
  });
}

// Read when the config is built, so each build takes the key from its own environment. expo-modules-core widens
// process.env to `any`; the typeof check narrows it back, as in src/config/server-url.ts.
function googleMapsAndroidKey(): string | undefined {
  const key: unknown = process.env.GOOGLE_MAPS_ANDROID_API_KEY;
  return typeof key === "string" ? key : undefined;
}

export default ({ config }: ConfigContext): ExpoConfig =>
  withLauncherLabel({
    ...config,
    // The Expo account the app builds under. This login also belongs to another account, so EAS needs it named.
    owner: "huntonas",
    // Created by `eas init`, which can't write into a dynamic config.
    extra: { eas: { projectId: "14727d21-7124-463d-a886-96e058058e1a" } },
    name: APP_SLUG,
    slug: APP_SLUG,
    scheme: APP_SLUG,
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
      infoPlist: {
        // The name under the icon. Expo leaves CFBundleName, and the executable, as `name`.
        CFBundleDisplayName: DISPLAY_NAME,
        // Spec §8, §11: the attendance check's one-time request for full accuracy, when only approximate location is
        // shared, until the app leaves the foreground. Its key is ATTENDANCE_PURPOSE_KEY in src/location/attendance.ts.
        NSLocationTemporaryUsageDescriptionDictionary: {
          AttendanceCheck: `${DISPLAY_NAME} checks that you're near the meeting, to stop spam, while the app is open. Your location never leaves your phone.`,
        },
      },
      // Spec §6: App Attest. "development" is what Xcode's capability writes; TestFlight and App Store builds ignore it and
      // always attest in production. EAS turns the capability on for the App ID from this entitlement.
      entitlements: { "com.apple.developer.devicecheck.appattest-environment": "development" },
    },
    android: {
      package: "com.goodersoftware.mymeetingapp",
      // Spec §11: coarse and fine foreground location only, never background.
      permissions: ["android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"],
      blockedPermissions: ["android.permission.ACCESS_BACKGROUND_LOCATION"],
      adaptiveIcon: { foregroundImage: MARK, monochromeImage: MARK, backgroundColor: ACCENT },
    },
    // expo-secure-store and expo-crypto have no entry. Secure-store's plugin would add a Face ID purpose string (the app
    // never asks for Face ID) and Android backup rules (Android never uses it: the phone's ID there is ANDROID_ID), and
    // expo-crypto has no plugin.
    plugins: [
      "expo-router",
      "expo-sqlite",
      ["expo-splash-screen", { image: MARK, imageWidth: 200, backgroundColor: ACCENT }],
      [
        // Spec §2: While Using only. `false` leaves the Always purpose strings out of the app entirely. The motion string
        // is required anyway: Apple rejects the upload without it (ITMS-90683) because the location library can reach
        // motion APIs, though the app never asks for them.
        "expo-location",
        {
          locationWhenInUsePermission: `${DISPLAY_NAME} uses your location to sort nearby meetings, rounded to about 1 km before searching, and to check you're near a meeting you tag. Your exact location never leaves your phone.`,
          locationAlwaysAndWhenInUsePermission: false,
          locationAlwaysPermission: false,
          motionUsagePermission: `${DISPLAY_NAME} never uses motion or fitness data. It asks only for your location, and only when you tap to use it.`,
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
