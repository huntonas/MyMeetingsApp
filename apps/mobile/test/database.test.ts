import type { AppDatabase } from "@/db/database";
import { appDatabase, inTransaction } from "@/db/database";
import { MIGRATIONS } from "@/db/migrations";
import { readCache, writeCache } from "@/cache/store";
import { meetingMoved } from "@/meetings/merged";
import { isFavorite, setFavorite } from "@/saved/favorites";
import { clearSobrietyDate, readSobrietyDate, saveSobrietyDate } from "@/sobriety/sobriety-date";
import type * as DatabaseModule from "@/db/database";
import type * as ExpoSqliteModule from "expo-sqlite";

import { resetAppData } from "./app-data";
import { relaunch } from "./native/expo-sqlite";

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
    relaunch();
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
    await old.execAsync(
      "drop table attendance_checks; drop table my_tags; drop table settings; drop table favorites; drop table recent_places; pragma user_version = 1",
    );

    let upgraded: AppDatabase | undefined;
    relaunch();
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
    await old.execAsync(
      "drop table attendance_checks; drop table my_tags; drop table settings; drop table favorites; pragma user_version = 2",
    );

    let upgraded: AppDatabase | undefined;
    relaunch();
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

describe("appDatabase: upgrading a phone installed before settings", () => {
  it("adds the settings table and keeps the saved copies, recent places and favorites it already had", async () => {
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
    await old.runAsync("insert into favorites (meeting_id, saved_at) values (?, ?)", ["a-meeting", 1]);
    // Turn this database back into one that ran only the first three migrations.
    await old.execAsync(
      "drop table attendance_checks; drop table my_tags; drop table settings; pragma user_version = 3",
    );

    let upgraded: AppDatabase | undefined;
    relaunch();
    await jest.isolateModulesAsync(async () => {
      upgraded = await freshDatabaseModule().appDatabase();
    });
    if (upgraded === undefined) throw new Error("jest.isolateModulesAsync didn't run its callback");

    expect(await upgraded.getFirstAsync("pragma user_version", [])).toEqual({
      user_version: MIGRATIONS.length,
    });
    expect(await upgraded.getAllAsync("select key from settings", [])).toEqual([]);
    expect(await upgraded.getAllAsync("select meeting_id from favorites", [])).toEqual([
      { meeting_id: "a-meeting" },
    ]);
    expect(await upgraded.getAllAsync("select label from recent_places", [])).toEqual([
      { label: "Nashville, TN" },
    ]);
    expect(
      await upgraded.getFirstAsync("select body from cache_entries where key = ?", ["vocabulary"]),
    ).toEqual({ body: "{}" });
  });
});

describe("appDatabase: upgrading a phone installed before the tag record", () => {
  it("adds the tag record and keeps everything it already had", async () => {
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
    await old.runAsync("insert into favorites (meeting_id, saved_at) values (?, ?)", ["a-meeting", 1]);
    await old.runAsync("insert into settings (key, value) values (?, ?)", ["sobriety_date", "2024-02-29"]);
    // Turn this database back into one that ran only the first four migrations.
    await old.execAsync("drop table attendance_checks; drop table my_tags; pragma user_version = 4");

    let upgraded: AppDatabase | undefined;
    relaunch();
    await jest.isolateModulesAsync(async () => {
      upgraded = await freshDatabaseModule().appDatabase();
    });
    if (upgraded === undefined) throw new Error("jest.isolateModulesAsync didn't run its callback");

    expect(await upgraded.getFirstAsync("pragma user_version", [])).toEqual({
      user_version: MIGRATIONS.length,
    });
    expect(await upgraded.getAllAsync("select meeting_id from my_tags", [])).toEqual([]);
    expect(await upgraded.getAllAsync("select key, value from settings", [])).toEqual([
      { key: "sobriety_date", value: "2024-02-29" },
    ]);
    expect(await upgraded.getAllAsync("select meeting_id from favorites", [])).toEqual([
      { meeting_id: "a-meeting" },
    ]);
    expect(await upgraded.getAllAsync("select label from recent_places", [])).toEqual([
      { label: "Nashville, TN" },
    ]);
    expect(
      await upgraded.getFirstAsync("select body from cache_entries where key = ?", ["vocabulary"]),
    ).toEqual({ body: "{}" });
  });
});

describe("appDatabase: upgrading a phone installed before the attendance check", () => {
  it("adds the attendance results and keeps everything it already had", async () => {
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
    await old.runAsync("insert into favorites (meeting_id, saved_at) values (?, ?)", ["a-meeting", 1]);
    await old.runAsync("insert into settings (key, value) values (?, ?)", ["sobriety_date", "2024-02-29"]);
    await old.runAsync(
      "insert into my_tags (meeting_id, name, tags, confirmed_at, updated_at) values (?, ?, ?, ?, ?)",
      ["a-meeting", "Nooners", '["quiet"]', 1, 1],
    );
    // Turn this database back into one that ran only the first five migrations.
    await old.execAsync("drop table attendance_checks; pragma user_version = 5");

    let upgraded: AppDatabase | undefined;
    relaunch();
    await jest.isolateModulesAsync(async () => {
      upgraded = await freshDatabaseModule().appDatabase();
    });
    if (upgraded === undefined) throw new Error("jest.isolateModulesAsync didn't run its callback");

    expect(await upgraded.getFirstAsync("pragma user_version", [])).toEqual({
      user_version: MIGRATIONS.length,
    });
    expect(await upgraded.getAllAsync("select meeting_id from attendance_checks", [])).toEqual([]);
    expect(await upgraded.getAllAsync("select meeting_id, tags from my_tags", [])).toEqual([
      { meeting_id: "a-meeting", tags: '["quiet"]' },
    ]);
    expect(await upgraded.getAllAsync("select key, value from settings", [])).toEqual([
      { key: "sobriety_date", value: "2024-02-29" },
    ]);
    expect(await upgraded.getAllAsync("select meeting_id from favorites", [])).toEqual([
      { meeting_id: "a-meeting" },
    ]);
    expect(await upgraded.getAllAsync("select label from recent_places", [])).toEqual([
      { label: "Nashville, TN" },
    ]);
    expect(
      await upgraded.getFirstAsync("select body from cache_entries where key = ?", ["vocabulary"]),
    ).toEqual({ body: "{}" });
  });
});

describe("transactions", () => {
  it("take turns, so two at once both land", async () => {
    await writeCache("meeting:a", {});
    await writeCache("meeting:b", {});
    await Promise.allSettled([meetingMoved("a", "a2", "move"), meetingMoved("b", "b2", "move")]);
    expect(await readCache("meeting:a2")).not.toBeNull();
    expect(await readCache("meeting:b2")).not.toBeNull();
    expect(await readCache("meeting:a")).toBeNull();
    expect(await readCache("meeting:b")).toBeNull();
  });

  it("still take turns after one fails", async () => {
    const db = await appDatabase();
    jest.spyOn(db, "withTransactionAsync").mockRejectedValueOnce(new Error("disk full"));
    await writeCache("meeting:a", {});
    await writeCache("meeting:b", {});
    const moves = await Promise.allSettled([
      meetingMoved("a", "a2", "move"),
      meetingMoved("b", "b2", "move"),
    ]);
    expect(moves.map((move) => move.status)).toEqual(["rejected", "fulfilled"]);
    expect(await readCache("meeting:b2")).not.toBeNull();
  });
});

// A transaction that has written and is waiting, then fails (a search save hitting a full disk): what it wrote is
// undone. Personal writes made meanwhile must not be undone with it.
async function whileAFailingTransactionIsOpen(write: () => Promise<void>) {
  let fail: () => void = () => undefined;
  let markOpen: () => void = () => undefined;
  const open = new Promise<void>((resolve) => {
    markOpen = resolve;
  });
  const failing = inTransaction(async (db) => {
    await db.runAsync("insert into cache_entries (key, body, saved_at) values (?, ?, ?)", [
      "search:1,1,25",
      "{}",
      1,
    ]);
    markOpen();
    await new Promise<void>((_resolve, reject) => {
      fail = () => {
        reject(new Error("disk full"));
      };
    });
  });
  await open;
  const writing = write();
  fail();
  await expect(failing).rejects.toThrow("disk full");
  await writing;
  expect(await readCache("search:1,1,25")).toBeNull();
}

describe("personal writes are never undone by someone else's failed transaction", () => {
  const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

  it("saving a favorite", async () => {
    await whileAFailingTransactionIsOpen(() => setFavorite(ID, true));
    expect(await isFavorite(ID)).toBe(true);
  });

  it("removing a favorite", async () => {
    await setFavorite(ID, true);
    await whileAFailingTransactionIsOpen(() => setFavorite(ID, false));
    expect(await isFavorite(ID)).toBe(false);
  });

  it("saving the sobriety date", async () => {
    await whileAFailingTransactionIsOpen(() => saveSobrietyDate({ year: 2024, month: 2, day: 29 }));
    expect(await readSobrietyDate()).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it("clearing the sobriety date", async () => {
    await saveSobrietyDate({ year: 2024, month: 2, day: 29 });
    await whileAFailingTransactionIsOpen(() => clearSobrietyDate());
    expect(await readSobrietyDate()).toBeNull();
  });
});

describe("test harness, not app behaviour: the fake expo-sqlite (test/native/expo-sqlite.ts) behaves like a real async database", () => {
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
