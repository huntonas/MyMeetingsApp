import initSqlJs, { type Database, type SqlValue } from "sql.js";

type Params = SqlValue[];

// sql.js throws whatever the underlying wasm engine gives it, not necessarily an Error.
function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

// expo-sqlite's async API, as far as the app uses it, over a real SQLite engine (sql.js), so every SQL statement the
// app writes runs for real in tests. The fake itself is synchronous underneath (sql.js has no async I/O): a test's
// own await points are the only place another task can interleave with it, never the middle of a single call here.
class FakeDatabase {
  constructor(private readonly db: Database) {}

  execAsync(source: string): Promise<void> {
    try {
      this.db.exec(source);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(asError(error));
    }
  }

  runAsync(source: string, params: Params): Promise<{ changes: number; lastInsertRowId: number }> {
    try {
      this.db.run(source, params);
      const [{ id } = {}] = this.rows("select last_insert_rowid() as id", []);
      return Promise.resolve({
        changes: this.db.getRowsModified(),
        lastInsertRowId: typeof id === "number" ? id : 0,
      });
    } catch (error) {
      return Promise.reject(asError(error));
    }
  }

  private rows(source: string, params: Params): Record<string, SqlValue>[] {
    const statement = this.db.prepare(source);
    statement.bind(params);
    const rows: Record<string, SqlValue>[] = [];
    while (statement.step()) rows.push(statement.getAsObject());
    statement.free();
    return rows;
  }

  getAllAsync(source: string, params: Params): Promise<Record<string, SqlValue>[]> {
    try {
      return Promise.resolve(this.rows(source, params));
    } catch (error) {
      return Promise.reject(asError(error));
    }
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

declare global {
  // TypeScript's global augmentation requires `var`. This models the one thing a JS module registry can't give a
  // fake: a real SQLite file persists on disk across a relaunch (a fresh module registry, jest.isolateModules), so
  // the fake keeps its open databases on globalThis instead, keyed by name, to match.
  var __mymeetingappFakeSqliteDatabases: Map<string, Database> | undefined;
}

export async function openDatabaseAsync(name: string): Promise<FakeDatabase> {
  const SQL = await engine;
  globalThis.__mymeetingappFakeSqliteDatabases ??= new Map();
  const databases = globalThis.__mymeetingappFakeSqliteDatabases;
  let db = databases.get(name);
  if (db === undefined) {
    db = new SQL.Database();
    databases.set(name, db);
  }
  return new FakeDatabase(db);
}
