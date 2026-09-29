import { parseArgs } from "node:util";

import { loadLocalEnvFile } from "@/env";

loadLocalEnvFile();

const { values } = parseArgs({ options: { "device-hash": { type: "string" } } });
const hash = values["device-hash"] ?? "";
if (!/^[0-9a-f]{64}$/.test(hash)) {
  console.error("Usage: pnpm --filter web db:block-device --device-hash <64 hex characters from tag_audit>");
  process.exit(1);
}

// The database client reads DATABASE_URL when it is imported, so import it after loading the env file.
const { blockDevice } = await import("@/server/devices/block-device");
const { pool } = await import("@/db/client");

try {
  const { excludedTags } = await blockDevice(hash);
  console.log(`Blocked; excluded ${String(excludedTags)} tag submissions`);
} finally {
  await pool.end();
}
