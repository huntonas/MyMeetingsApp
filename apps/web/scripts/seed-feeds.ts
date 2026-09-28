import { readFile } from "node:fs/promises";

import { parseRegistry } from "@mymeetingapp/feed-kit";

import { loadLocalEnvFile } from "@/env";

loadLocalEnvFile();

const path = process.argv[2];
if (path === undefined) {
  throw new Error("Usage: pnpm --filter web db:seed-feeds <path-to-registry.yaml>");
}

// The database client reads DATABASE_URL when it is imported, so import it after loading the env file.
const { seedFeedsFromRegistry } = await import("@/db/seed-feeds");
const { pool } = await import("@/db/client");

try {
  // A missing file is an error here (unlike in discovery): seeding nothing by mistake must be loud.
  const entries = parseRegistry(await readFile(path, "utf-8"));
  const { upserted, optedOut, skipped } = await seedFeedsFromRegistry(entries);
  console.log(`Seeded ${String(upserted)} feeds (${String(optedOut)} opted out, ${String(skipped)} skipped)`);
} finally {
  await pool.end();
}
