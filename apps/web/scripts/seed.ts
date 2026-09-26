import { loadLocalEnvFile } from "@/env";

loadLocalEnvFile();

// The database client reads DATABASE_URL when it is imported, so import it after loading the env file.
const { seedVocabulary } = await import("@/db/seed-vocabulary");
const { pool } = await import("@/db/client");

try {
  console.log(`Seeded ${String(await seedVocabulary())} tags`);
} finally {
  await pool.end();
}
