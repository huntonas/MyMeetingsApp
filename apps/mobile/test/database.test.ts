import type { AppDatabase } from "@/db/database";
import { appDatabase } from "@/db/database";
import { MIGRATIONS } from "@/db/migrations";
import type * as DatabaseModule from "@/db/database";
import type * as ExpoSqliteModule from "expo-sqlite";

import { resetAppData } from "./app-data";

beforeEach(resetAppData);

// jest.isolateModulesAsync needs a synchronous require to get modules from its own sandboxed registry: Jest runs in
// CommonJS mode here, so `await import(...)` hits Node's native dynamic import instead and fails outside it.
function freshDatabaseModule(): typeof DatabaseModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above.
  return require("@/db/database") as typeof DatabaseModule;
}

function freshExpoSqliteModule(): typeof ExpoSqliteModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above.
  return require("expo-sqlite") as typeof ExpoSqliteModule;
}

describe("appDatabase: reopening the same database", () => {
  it("skips migrations it's already run, and keeps what a previous launch saved", async () => {
    const first = await appDatabase();
    await first.runAsync("insert into cache_entries (key, body, saved_at) values (?, ?, ?)", [
      "vocabulary",
      "{}",
      1,
    ]);

    let second: AppDatabase | undefined;
    await jest.isolateModulesAsync(async () => {
      // A relaunched app: a fresh module registry, so @/db/database's memoized `opening` promise is gone too — but
      // the fake SQLite "file" (test/native/expo-sqlite.ts) persists outside any module registry, so re-opening by
      // name gives back the same database `first` already wrote to, as a real on-disk file would.
      second = await freshDatabaseModule().appDatabase();
    });
    if (second === undefined) throw new Error("jest.isolateModulesAsync didn't run its callback");

    expect(await second.getFirstAsync("pragma user_version", [])).toEqual({
      user_version: MIGRATIONS.length,
    });
    expect(
      await second.getFirstAsync("select body from cache_entries where key = ?", ["vocabulary"]),
    ).toEqual({ body: "{}" });
  });
});

describe("appDatabase: upgrading a phone installed before recent places", () => {
  it("adds the recent places table and keeps the saved copies it already had", async () => {
    const old = await appDatabase();
    await old.runAsync("insert into cache_entries (key, body, saved_at) values (?, ?, ?)", [
      "vocabulary",
      "{}",
      1,
    ]);
    // Turn this database back into one that only ever ran the first migration.
    await old.execAsync("drop table favorites; drop table recent_places; pragma user_version = 1");

    let upgraded: AppDatabase | undefined;
    await jest.isolateModulesAsync(async () => {
      upgraded = await freshDatabaseModule().appDatabase();
    });
    if (upgraded === undefined) throw new Error("jest.isolateModulesAsync didn't run its callback");

    expect(await upgraded.getFirstAsync("pragma user_version", [])).toEqual({
      user_version: MIGRATIONS.length,
    });
    expect(await upgraded.getAllAsync("select label from recent_places", [])).toEqual([]);
    expect(
      await upgraded.getFirstAsync("select body from cache_entries where key = ?", ["vocabulary"]),
    ).toEqual({ body: "{}" });
  });
});

describe("appDatabase: upgrading a phone installed before favorites", () => {
  it("adds the favorites table and keeps the saved copies and recent places it already had", async () => {
    const old = await appDatabase();
    await old.runAsync("insert into cache_entries (key, body, saved_at) values (?, ?, ?)", [
      "vocabulary",
      "{}",
      1,
    ]);
    await old.runAsync(
      "insert into recent_places (label, latitude, longitude, used_at) values (?, ?, ?, ?)",
      ["Nashville, TN", 36.16, -86.78, 1],
    );
    // Turn this database back into one that ran only the first two migrations.
    await old.execAsync("drop table favorites; pragma user_version = 2");

    let upgraded: AppDatabase | undefined;
    await jest.isolateModulesAsync(async () => {
      upgraded = await freshDatabaseModule().appDatabase();
    });
    if (upgraded === undefined) throw new Error("jest.isolateModulesAsync didn't run its callback");

    expect(await upgraded.getFirstAsync("pragma user_version", [])).toEqual({
      user_version: MIGRATIONS.length,
    });
    expect(await upgraded.getAllAsync("select meeting_id from favorites", [])).toEqual([]);
    expect(
      await upgraded.getFirstAsync("select body from cache_entries where key = ?", ["vocabulary"]),
    ).toEqual({ body: "{}" });
    expect(await upgraded.getAllAsync("select label from recent_places", [])).toEqual([
      { label: "Nashville, TN" },
    ]);
  });
});

describe("the fake expo-sqlite (test/native/expo-sqlite.ts) behaves like a real async database", () => {
  it("returns the real last_insert_rowid, not a placeholder", async () => {
    const db = await appDatabase();
    const first = await db.runAsync("insert into cache_entries (key, body, saved_at) values (?, ?, ?)", [
      "a",
      "{}",
      1,
    ]);
    const second = await db.runAsync("insert into cache_entries (key, body, saved_at) values (?, ?, ?)", [
      "b",
      "{}",
      1,
    ]);
    expect(second.lastInsertRowId).toBeGreaterThan(first.lastInsertRowId);
  });

  it("rejects rather than throwing synchronously on a bad statement", async () => {
    const db = await appDatabase();
    await expect(db.runAsync("not sql", [])).rejects.toThrow();
    await expect(db.execAsync("not sql either")).rejects.toThrow();
  });
});

describe("appDatabase: recovering from a failed open", () => {
  it("clears its memoized promise after a failure, so a later call can retry", async () => {
    await jest.isolateModulesAsync(async () => {
      const sqlite = freshExpoSqliteModule();
      jest.spyOn(sqlite, "openDatabaseAsync").mockRejectedValueOnce(new Error("simulated open failure"));
      const { appDatabase: freshAppDatabase } = freshDatabaseModule();

      await expect(freshAppDatabase()).rejects.toThrow("simulated open failure");
      const db = await freshAppDatabase();
      expect(await db.getFirstAsync("pragma user_version", [])).toEqual({
        user_version: MIGRATIONS.length,
      });
    });
  });
});
