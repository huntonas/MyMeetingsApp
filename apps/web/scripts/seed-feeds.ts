import { readFile } from "node:fs/promises";

import { RegistryEntry } from "@mymeetingapp/feed-kit";
import { parse } from "yaml";

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
  const raw = await readFile(path, "utf-8");
  const parsed: unknown = parse(raw);
  const entries = (Array.isArray(parsed) ? parsed : []).map((entry) => RegistryEntry.parse(entry));
  const { upserted, optedOut, skipped } = await seedFeedsFromRegistry(entries);
  console.log(`Seeded ${String(upserted)} feeds (${String(optedOut)} opted out, ${String(skipped)} skipped)`);
} finally {
  await pool.end();
}
