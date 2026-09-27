import type { VercelConfig } from "@vercel/config/v1";

// Migrations run in the build, against DATABASE_URL_UNPOOLED (each preview has its own Neon branch),
// never at app startup. They must work with both the previous and the new code.
export const config: VercelConfig = {
  framework: "nextjs",
  buildCommand: "pnpm run db:migrate && pnpm run build",
};
