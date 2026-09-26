import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const PARENT_IMPORT = { group: ["../*"], message: "Use the @/ alias instead of a parent-relative import." };

export default defineConfig([
  globalIgnores([
    "**/node_modules/",
    "**/.next/",
    "**/.turbo/",
    "**/drizzle/",
    "**/next-env.d.ts",
    ".superpowers/",
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
    ignores: ["apps/web/src/lib/api/respond.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/server",
              importNames: ["NextResponse"],
              message: "Use jsonResponse() or apiError() from @/lib/api/respond.",
            },
          ],
          patterns: [PARENT_IMPORT],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='Response'][property.name='json']",
          message: "Use jsonResponse() or apiError() from @/lib/api/respond.",
        },
      ],
    },
  },
  {
    files: ["apps/web/src/lib/api/respond.ts"],
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
]);
