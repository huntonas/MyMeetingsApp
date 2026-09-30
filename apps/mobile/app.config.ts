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
  android: { package: "com.goodersoftware.mymeetingapp" },
  plugins: [
    "expo-router",
    "expo-sqlite",
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
