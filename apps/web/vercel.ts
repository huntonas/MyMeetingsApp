import type { VercelConfig } from "@vercel/config/v1";

// Preview builds first restore the shared "preview" Neon branch from "seed" (reference data only), then every
// build migrates its own database against DATABASE_URL_UNPOOLED, never at app startup. Migrations must work with
// both the previous and the new code.
export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "pnpm run db:reset-preview && pnpm run db:migrate && pnpm run build",
  // Every 15 minutes (spec §3). Needs Vercel Pro: Hobby allows only daily crons.
  crons: [{ path: "/api/cron/sync-feeds", schedule: "*/15 * * * *" }],
};
