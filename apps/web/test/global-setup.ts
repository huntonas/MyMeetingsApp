import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import type { TestProject } from "vitest/node";

const RUN_DATABASE = /^mma_test_(\d+)$/;

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it's running, as another user.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function connected(url: URL): Promise<Client> {
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

// Global setup runs outside the test workers, so it reads the URL from the config's test.env. It makes this run's
// database (dropping those of runs that died before they could drop their own), migrates it, and drops it after.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const url = project.config.env.DATABASE_URL;
  if (typeof url !== "string") throw new Error("vitest.config.ts must set test.env.DATABASE_URL");
  const name = new URL(url).pathname.slice(1);
  const server = new URL(url);
  server.pathname = "/postgres";
  const admin = await connected(server);
  const { rows } = await admin.query<{ datname: string }>("select datname from pg_database");
  for (const { datname } of rows) {
    const pid = RUN_DATABASE.exec(datname)?.[1];
    if (datname === name || (pid !== undefined && !isRunning(Number(pid)))) {
      await admin.query(`drop database "${datname}" with (force)`);
    }
  }
  await admin.query(`create database "${name}"`);
  await admin.end();

  const pool = new Pool({ connectionString: url });
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  await pool.end();

  return async () => {
    const after = await connected(server);
    await after.query(`drop database "${name}" with (force)`);
    await after.end();
  };
}
