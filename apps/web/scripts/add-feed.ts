import { parseArgs } from "node:util";

import { loadLocalEnvFile } from "@/env";

loadLocalEnvFile();

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
    name: { type: "string" },
    "entity-type": { type: "string" },
    state: { type: "string" },
    url: { type: "string" },
    priority: { type: "string" },
  },
});

// The database client reads DATABASE_URL when it is imported, so import it after loading the env file.
const { FeedInput, upsertFeed } = await import("@/db/upsert-feed");
const { pool } = await import("@/db/client");

try {
  const id = await upsertFeed(
    FeedInput.parse({
      slug: values.slug ?? "",
      name: values.name ?? "",
      entityType: values["entity-type"] ?? "",
      state: values.state ?? "",
      url: values.url ?? "",
      priority: values.priority === undefined ? undefined : Number(values.priority),
    }),
  );
  console.log(`Feed ${String(id)} saved`);
} finally {
  await pool.end();
}
