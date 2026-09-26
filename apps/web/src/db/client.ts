import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { readEnv } from "@/env";

// Pooled connection string. The pool connects lazily, so importing this at build time never queries.
export const pool = new Pool({ connectionString: readEnv("DATABASE_URL"), max: 10, idleTimeoutMillis: 5000 });
attachDatabasePool(pool);

export const db = drizzle({ client: pool });
