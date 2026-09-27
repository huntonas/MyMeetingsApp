import { defineConfig } from "drizzle-kit";

import { loadLocalEnvFile } from "./src/env";
import { directDatabaseUrl } from "./src/db/connection-url";

loadLocalEnvFile();

// Migrations use the direct (unpooled) connection when one is configured. Loading this file must not
// throw (knip loads it too); drizzle-kit itself reports a missing URL when a command needs one.
const url = directDatabaseUrl() ?? "";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
