import initSqlJs, { type Database, type SqlValue } from "sql.js";

type Params = SqlValue[];

// expo-sqlite's async API, as far as the app uses it, over a real SQLite engine (sql.js), so every SQL statement the
// app writes runs for real in tests. Each open is a fresh in-memory database; Jest gives each test file its own
// module registry, so each file gets its own database.
class FakeDatabase {
  constructor(private readonly db: Database) {}

  execAsync(source: string): Promise<void> {
    this.db.exec(source);
    return Promise.resolve();
  }

  runAsync(source: string, params: Params): Promise<{ changes: number; lastInsertRowId: number }> {
    this.db.run(source, params);
    return Promise.resolve({ changes: this.db.getRowsModified(), lastInsertRowId: 0 });
  }

  getAllAsync(source: string, params: Params): Promise<Record<string, SqlValue>[]> {
    const statement = this.db.prepare(source);
    statement.bind(params);
    const rows: Record<string, SqlValue>[] = [];
    while (statement.step()) rows.push(statement.getAsObject());
    statement.free();
    return Promise.resolve(rows);
  }

  async getFirstAsync(source: string, params: Params): Promise<Record<string, SqlValue> | null> {
    return (await this.getAllAsync(source, params))[0] ?? null;
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.db.exec("begin");
    try {
      await task();
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }
}

const engine = initSqlJs();

export async function openDatabaseAsync(_name: string): Promise<FakeDatabase> {
  return new FakeDatabase(new (await engine).Database());
}
