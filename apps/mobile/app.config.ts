import type { ConfigContext, ExpoConfig } from "expo/config";

// The font files ship inside the app, copied at build time from the npm package; nothing is fetched at run time.
const FONTS = "node_modules/@expo-google-fonts/atkinson-hyperlegible";
const REGULAR = `${FONTS}/400Regular/AtkinsonHyperlegible_400Regular.ttf`;
const BOLD = `${FONTS}/700Bold/AtkinsonHyperlegible_700Bold.ttf`;

// BRAND.appName (packages/shared/src/brand.ts); app-shell.test.tsx fails if the two differ.
const APP_NAME = "mymeetingapp";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: APP_NAME,
  slug: APP_NAME,
  scheme: APP_NAME,
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  // Every build ships its JavaScript inside the app; nothing is downloaded over the air.
  updates: { enabled: false },
  ios: { bundleIdentifier: "com.goodersoftware.mymeetingapp", supportsTablet: false },
  android: {
    package: "com.goodersoftware.mymeetingapp",
    // Spec §11: coarse and fine foreground location only, never background.
    permissions: ["android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"],
    blockedPermissions: ["android.permission.ACCESS_BACKGROUND_LOCATION"],
  },
  plugins: [
    "expo-router",
    "expo-sqlite",
    [
      // Spec §2: While Using only. `false` leaves the Always and motion purpose strings out of the app entirely.
      "expo-location",
      {
        locationWhenInUsePermission:
          "mymeetingapp uses your location to sort nearby meetings. It rounds it to about 1 km before searching, and your exact location never leaves your phone.",
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        motionUsagePermission: false,
      },
    ],
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
