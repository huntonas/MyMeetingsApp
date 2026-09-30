// Tests read the API from a real local server on this fixed port. Expo may inline EXPO_PUBLIC_* values when it
// transforms a file, so the value is set here, before any transform, and test files share one worker.
process.env.EXPO_PUBLIC_SERVER_URL = "http://127.0.0.1:3197";
// jest-expo's winter runtime installs a stub fetch backed by fake native classes unless this is set, which would
// never reach the real server above. The app ships expo/fetch; tests use Node's fetch instead.
process.env.EXPO_PUBLIC_USE_RN_FETCH = "1";

// pnpm keeps packages under node_modules/.pnpm/<name>@<version>/node_modules/<name>; these must still be transformed.
const TRANSFORMED = [
  "(jest-)?react-native",
  "@react-native(-community)?",
  "expo(nent)?",
  "@expo(nent)?/.*",
  "@expo-google-fonts/.*",
  "expo-router",
  "standard-navigation",
  "react-navigation",
  "@react-navigation/.*",
  "react-native-maps",
].join("|");

/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  maxWorkers: 1,
  // Spies on React Native core APIs (Linking, AppState) never leak from one test into the next. The preset already
  // mocks some of them (Linking.openURL is a jest.fn), and spying on a mock returns that same mock, which restoring
  // doesn't reset; clearing drops the calls it recorded in earlier tests.
  clearMocks: true,
  restoreMocks: true,
  setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
  testMatch: ["<rootDir>/test/**/*.test.{ts,tsx}"],
  transformIgnorePatterns: [`node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?(?:${TRANSFORMED}))`],
  // Native modules are faked only here, at their package boundary (docs/standards.md). Fakes come first: the first
  // matching pattern wins.
  moduleNameMapper: {
    "^expo-sqlite$": "<rootDir>/test/native/expo-sqlite.ts",
    "^expo-application$": "<rootDir>/test/native/expo-application.ts",
    "^expo-location$": "<rootDir>/test/native/expo-location.ts",
    "^@modules/native-location$": "<rootDir>/test/native/native-location.ts",
    "^react-native-maps$": "<rootDir>/test/native/react-native-maps.tsx",
    "^@react-native-community/datetimepicker$": "<rootDir>/test/native/datetimepicker.tsx",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
