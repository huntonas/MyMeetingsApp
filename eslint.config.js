import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const PARENT_IMPORT = { group: ["../*"], message: "Use the @/ alias instead of a parent-relative import." };
// The app's one way to each native capability (docs/standards.md). Exemptions restate the bans they don't lift.
const SQLITE_IMPORT = { name: "expo-sqlite", message: "Use appDatabase() from @/db/database." };
const LOCATION_IMPORTS = [
  {
    name: "expo-location",
    message:
      "Use currentPosition() from @/location/current-position, or checkAttendance() from @/location/attendance.",
  },
  {
    name: "@modules/native-location",
    message: "Use findPlace() from @/location/find-place, or checkAttendance() from @/location/attendance.",
  },
];
const DEVICE_ID_IMPORTS = [
  { name: "expo-secure-store", message: "Use writeHeaders() from @/device/write-headers." },
  { name: "expo-crypto", message: "Use writeHeaders() from @/device/write-headers." },
  {
    name: "expo-application",
    importNames: ["getAndroidId", "getIosIdForVendorAsync"],
    message: "Use writeHeaders() from @/device/write-headers.",
  },
];

export default defineConfig([
  globalIgnores([
    "**/node_modules/",
    "**/.next/",
    "**/.turbo/",
    "**/drizzle/",
    "**/next-env.d.ts",
    ".superpowers/",
    "apps/mobile/.expo/",
    "apps/mobile/ios/",
    "apps/mobile/android/",
    "apps/mobile/modules/*/android/build/",
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      eqeqeq: "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Command-line scripts report to the terminal.
    files: ["apps/web/scripts/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Each tool's own CLI entry point reports progress and results to the terminal.
    files: ["tools/*/src/main.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Shared package tests exercise the public entry point only.
    files: ["packages/shared/test/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["../src/*", "!../src/index"], message: "Import from ../src/index (the public API)." },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/lib/api/respond.ts", "apps/web/src/proxy.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/server",
              importNames: ["NextResponse"],
              message: "Use jsonResponse() from @/lib/api/respond; for failures, throw inside withErrors.",
            },
          ],
          patterns: [PARENT_IMPORT],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='Response'][property.name='json']",
          message: "Use jsonResponse() from @/lib/api/respond; for failures, throw inside withErrors.",
        },
      ],
    },
  },
  // respond.ts is the one JSON sender; proxy.ts lets allowed requests through with NextResponse.next().
  {
    files: ["apps/web/src/lib/api/respond.ts", "apps/web/src/proxy.ts"],
    rules: { "no-restricted-imports": ["error", { patterns: [PARENT_IMPORT] }] },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/env.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read environment variables with readEnv() from @/env.",
        },
      ],
    },
  },
  {
    files: ["apps/mobile/**/*.{ts,tsx,js}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // The app logs nothing: no location, search text or device IDs can end up in a device log.
      "no-console": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [SQLITE_IMPORT, ...LOCATION_IMPORTS, ...DEVICE_ID_IMPORTS],
          patterns: [PARENT_IMPORT],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Use getJson/postJson/sendWrite from @/api/client." },
      ],
      "no-restricted-properties": [
        "error",
        {
          property: "withTransactionAsync",
          message: "Use inTransaction() from @/db/database, which runs one transaction at a time.",
        },
      ],
    },
  },
  {
    // Migrations run while the database opens, before inTransaction() can be called.
    files: ["apps/mobile/src/db/database.ts"],
    rules: { "no-restricted-properties": "off" },
  },
  {
    // The one place allowed to call fetch directly.
    files: ["apps/mobile/src/api/client.ts"],
    rules: { "no-restricted-globals": "off" },
  },
  {
    // The one place allowed to open the database directly, and the test proving appDatabase() recovers from a failed
    // open (it has to spy on expo-sqlite's own openDatabaseAsync).
    files: ["apps/mobile/src/db/database.ts", "apps/mobile/test/database.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [...LOCATION_IMPORTS, ...DEVICE_ID_IMPORTS], patterns: [PARENT_IMPORT] },
      ],
    },
  },
  {
    // The one place allowed to reach the location packages directly.
    files: ["apps/mobile/src/location/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [SQLITE_IMPORT, ...DEVICE_ID_IMPORTS], patterns: [PARENT_IMPORT] },
      ],
    },
  },
  {
    // The one place allowed to read the phone's ID.
    files: ["apps/mobile/src/device/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [SQLITE_IMPORT, ...LOCATION_IMPORTS], patterns: [PARENT_IMPORT] },
      ],
    },
  },
  {
    // The fakes standing in for native packages in tests.
    files: ["apps/mobile/test/native/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [PARENT_IMPORT] }],
    },
  },
  {
    // The Expo config lives at the workspace root.
    files: ["apps/mobile/test/app-shell.test.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Jest loads its config as CommonJS.
    files: ["apps/mobile/jest.config.js"],
    languageOptions: { sourceType: "commonjs", globals: { module: "writable", process: "readonly" } },
  },
]);
