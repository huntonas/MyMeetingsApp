import { existsSync } from "node:fs";

// The only place code reads process.env. Add a name here when its first consumer lands.
type EnvName =
  | "DATABASE_URL"
  | "DATABASE_URL_UNPOOLED"
  | "MIN_VERSION_IOS"
  | "MIN_VERSION_ANDROID"
  | "LATEST_VERSION_IOS"
  | "LATEST_VERSION_ANDROID"
  | "FEATURE_TAGGING"
  | "FEATURE_SUGGESTIONS"
  | "CENSUS_GEOCODER_URL"
  | "CRON_SECRET"
  | "VERCEL_ENV"
  | "NEON_API_URL"
  | "NEON_API_KEY"
  | "NEON_PROJECT_ID"
  | "NEON_PREVIEW_BRANCH_ID";

export function readEnv(name: EnvName): string | undefined {
  const value = process.env[name]?.trim();
  return value === "" ? undefined : value;
}

// For tooling (drizzle-kit, scripts). Next.js loads .env.local itself.
// Variables already set in the environment always win over the file.
export function loadLocalEnvFile(): void {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
}
