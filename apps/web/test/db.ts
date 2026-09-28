import { sql } from "drizzle-orm";

import { db } from "@/db/client";

// Add each new table here when it is created.
const APP_TABLES = [
  "tag_audit",
  "tag_counts",
  "tag_submissions",
  "meeting_aliases",
  "feed_meetings",
  "meetings",
  "feeds",
  "address_geocodes",
  "tags",
];

export async function resetDb(): Promise<void> {
  await db.execute(sql.raw(`truncate table ${APP_TABLES.join(", ")} restart identity cascade`));
}
