import { appDatabase } from "@/db/database";

// Every table the app keeps, emptied between tests. Add each new table here in the task that creates it.
const TABLES = [
  "cache_entries",
  "recent_places",
  "favorites",
  "settings",
  "my_tags",
  "attendance_checks",
] as const;

export async function resetAppData(): Promise<void> {
  const db = await appDatabase();
  for (const table of TABLES) await db.execAsync(`delete from ${table}`);
}

// Fails only the statements starting with `sql`, as a full disk or a damaged table would; everything else runs.
export async function failStatements(method: "runAsync" | "getAllAsync" | "getFirstAsync", sql: string) {
  const db = await appDatabase();
  if (method === "getFirstAsync") {
    const real = db.getFirstAsync.bind(db);
    return jest
      .spyOn(db, "getFirstAsync")
      .mockImplementation((source, params) =>
        source.startsWith(sql) ? Promise.reject(new Error("disk error")) : real(source, params),
      );
  }
  if (method === "runAsync") {
    const real = db.runAsync.bind(db);
    return jest
      .spyOn(db, "runAsync")
      .mockImplementation((source, params) =>
        source.startsWith(sql) ? Promise.reject(new Error("disk full")) : real(source, params),
      );
  }
  const real = db.getAllAsync.bind(db);
  return jest
    .spyOn(db, "getAllAsync")
    .mockImplementation((source, params) =>
      source.startsWith(sql) ? Promise.reject(new Error("disk error")) : real(source, params),
    );
}
