import { appDatabase } from "@/db/database";

// Every table the app keeps, emptied between tests. Add each new table here in the task that creates it.
const TABLES = ["cache_entries"] as const;

export async function resetAppData(): Promise<void> {
  const db = await appDatabase();
  for (const table of TABLES) await db.execAsync(`delete from ${table}`);
}
