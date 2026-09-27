import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { readEnv } from "@/env";
import { withVerifiedTls } from "@/db/connection-url";

// Pooled connection string. The pool connects lazily, so importing this at build time never queries.
export const pool = new Pool({
  connectionString: withVerifiedTls(readEnv("DATABASE_URL")),
  max: 10,
  idleTimeoutMillis: 5000,
});
attachDatabasePool(pool);

export const db = drizzle({ client: pool });
