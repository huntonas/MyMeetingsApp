import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { TestProject } from "vitest/node";

// Global setup runs outside the test workers, so it reads the URL from the config's test.env.
export default async function setup(project: TestProject): Promise<void> {
  const url = project.config.env.DATABASE_URL;
  if (typeof url !== "string") throw new Error("vitest.config.ts must set test.env.DATABASE_URL");
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  await pool.end();
}
