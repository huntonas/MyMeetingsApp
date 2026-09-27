import type { IncomingHttpHeaders } from "node:http";
import { format } from "node:util";

import { eq, isNull, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { feedMeetings, feeds, meetings } from "@/db/schema";
import { upsertFeed } from "@/db/upsert-feed";
import { runSync } from "@/server/sync/run-sync";

import { resetDb } from "./db";
import { startServer } from "./http-server";

const servers: { close(): Promise<void> }[] = [];
beforeEach(resetDb);
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
afterAll(() => pool.end());

function meetingJson(count: number) {
  return JSON.stringify(
    Array.from({ length: count }, (_, i) => ({
      slug: `m${String(i)}`,
      name: `M${String(i)}`,
      day: i % 7,
      time: "19:00",
      formatted_address: `${String(i)} Main St, Nashville, TN`,
      latitude: 36 + i / 100,
      longitude: -86.78,
      timezone: "America/Chicago",
    })),
  );
}

async function feedServing(slug: string, reply: Parameters<typeof startServer>[0]) {
  const server = await startServer(reply);
  servers.push(server);
  const id = await upsertFeed({
    slug,
    name: slug,
    entityType: "intergroup",
    state: "TN",
    url: `${server.baseUrl}/${slug}`,
  });
  return { id, server };
}

async function primaryFeedIds() {
  const rows = await db
    .select({ feedId: feedMeetings.feedId })
    .from(meetings)
    .innerJoin(feedMeetings, eq(feedMeetings.id, meetings.primaryFeedMeetingId))
    .where(isNull(meetings.archivedAt));
  return rows.map((row) => row.feedId);
}

async function feed(id: number) {
  const [row] = await db.select().from(feeds).where(eq(feeds.id, id));
  return row;
}

describe("runSync", () => {
  it("syncs due feeds and keeps going when one fails", async () => {
    const good = await feedServing("good", () => ({ status: 200, body: meetingJson(3) }));
    const bad = await feedServing("bad", () => ({ status: 500 }));
    expect(await runSync(60_000)).toEqual({
      status: "done",
      synced: 1,
      unchanged: 0,
      failed: 1,
      geocoded: 0,
    });
    expect(await feed(good.id)).toMatchObject({ meetingCount: 3, lastError: null });
    expect(await feed(bad.id)).toMatchObject({ lastError: "HTTP 500", lastSuccessAt: null });
    expect(await db.select().from(meetings).where(isNull(meetings.archivedAt))).toHaveLength(3);
  });

  it("records a restricted feed and doesn't retry it within the hour", async () => {
    const restricted = await feedServing("restricted", () => ({ status: 403 }));
    await runSync(60_000);
    expect((await feed(restricted.id))?.lastError).toBe("restricted (HTTP 403)");
    expect(await runSync(60_000)).toMatchObject({ synced: 0, failed: 0 });
    expect(restricted.server.requests).toHaveLength(1);
  });

  it("doesn't sync a feed that succeeded within 12 hours", async () => {
    const recent = await feedServing("recent", () => ({ status: 200, body: meetingJson(1) }));
    await db
      .update(feeds)
      .set({
        lastSuccessAt: new Date(Date.now() - 11 * 3600_000),
        lastAttemptAt: new Date(Date.now() - 11 * 3600_000),
      })
      .where(eq(feeds.id, recent.id));
    expect(await runSync(60_000)).toMatchObject({ synced: 0 });
    expect(recent.server.requests).toHaveLength(0);
  });

  it("treats an unchanged feed as a success and keeps its meetings", async () => {
    let calls = 0;
    const cached = await feedServing("cached", () =>
      calls++ === 0 ? { status: 200, body: meetingJson(2), headers: { ETag: '"v1"' } } : { status: 304 },
    );
    await runSync(60_000);
    await db
      .update(feeds)
      .set({ lastSuccessAt: new Date(0), lastAttemptAt: new Date(0) })
      .where(eq(feeds.id, cached.id));
    expect(await runSync(60_000)).toMatchObject({ unchanged: 1 });
    expect(cached.server.requests[1]?.headers["if-none-match"]).toBe('"v1"');
    expect(await db.select().from(meetings).where(isNull(meetings.archivedAt))).toHaveLength(2);
  });

  it("does not apply a feed that shrank by more than half", async () => {
    let body = meetingJson(40);
    const shrinking = await feedServing("shrinking", () => ({ status: 200, body }));
    await runSync(60_000);
    body = meetingJson(10);
    await db
      .update(feeds)
      .set({ lastSuccessAt: new Date(0), lastAttemptAt: new Date(0) })
      .where(eq(feeds.id, shrinking.id));
    expect(await runSync(60_000)).toMatchObject({ failed: 1 });
    expect((await feed(shrinking.id))?.lastError).toBe("meeting count dropped from 40 to 10; not applied");
    expect(await db.select().from(meetings).where(isNull(meetings.archivedAt))).toHaveLength(40);
  });

  it("applies a feed that shrinks to exactly half", async () => {
    let body = meetingJson(40);
    const exactlyHalf = await feedServing("exactly-half", () => ({ status: 200, body }));
    await runSync(60_000);
    body = meetingJson(20);
    await db
      .update(feeds)
      .set({ lastSuccessAt: new Date(0), lastAttemptAt: new Date(0) })
      .where(eq(feeds.id, exactlyHalf.id));
    expect(await runSync(60_000)).toMatchObject({ synced: 1, failed: 0 });
    expect(await feed(exactlyHalf.id)).toMatchObject({ meetingCount: 20, lastError: null });
    expect(await db.select().from(meetings).where(isNull(meetings.archivedAt))).toHaveLength(20);
  });

  it("applies a feed whose previous count is below the shrink-guard minimum", async () => {
    let body = meetingJson(10);
    const small = await feedServing("small", () => ({ status: 200, body }));
    await runSync(60_000);
    body = meetingJson(2);
    await db
      .update(feeds)
      .set({ lastSuccessAt: new Date(0), lastAttemptAt: new Date(0) })
      .where(eq(feeds.id, small.id));
    expect(await runSync(60_000)).toMatchObject({ synced: 1, failed: 0 });
    expect(await feed(small.id)).toMatchObject({ meetingCount: 2, lastError: null });
    expect(await db.select().from(meetings).where(isNull(meetings.archivedAt))).toHaveLength(2);
  });

  it("records a feed that isn't a meeting array", async () => {
    const odd = await feedServing("odd", () => ({ status: 200, body: '{"meetings":[]}' }));
    await runSync(60_000);
    expect((await feed(odd.id))?.lastError).toBe("Feed is not a JSON array of meetings");
  });

  it("logs a database failure's query and constraint, but none of the feed's content", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const poisoned = await feedServing("poisoned", () => ({
      status: 200,
      body: JSON.stringify([
        { slug: "p", name: "Secret Poison Group", day: 1, time: "19:00", formatted_address: "77 Hidden Ln" },
      ]),
    }));
    // A constraint the feed's content breaks, so applying the feed fails inside the database.
    await db.execute(
      sql`alter table feed_meetings add constraint probe_check check (name <> 'Secret Poison Group')`,
    );
    try {
      expect(await runSync(60_000)).toMatchObject({ failed: 1 });
    } finally {
      await db.execute(sql`alter table feed_meetings drop constraint probe_check`);
    }
    const logged = log.mock.calls.map((args) => format(...args)).join("\n");
    expect(logged).toContain(`feed ${String(poisoned.id)}`);
    expect(logged).toContain('insert into "feed_meetings"');
    expect(logged).toContain("probe_check");
    expect(logged).not.toContain("Secret Poison");
    expect(logged).not.toContain("Hidden Ln");
  });

  it("stops starting feeds when the budget is spent", async () => {
    await feedServing("late", () => ({ status: 200, body: meetingJson(1) }));
    expect(await runSync(0)).toMatchObject({ status: "done", synced: 0 });
  });

  it("archives the meetings of an opted-out feed", async () => {
    const leaving = await feedServing("leaving", () => ({ status: 200, body: meetingJson(2) }));
    await runSync(60_000);
    await db.update(feeds).set({ optedOut: true }).where(eq(feeds.id, leaving.id));
    await runSync(60_000);
    expect(await db.select().from(meetings).where(isNull(meetings.archivedAt))).toHaveLength(0);
    expect(await db.select().from(feedMeetings).where(isNull(feedMeetings.archivedAt))).toHaveLength(0);
  });

  it("logs a lock session dropped mid-run instead of crashing, and still syncs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dropped = await feedServing("dropped", async () => {
      await db.execute(sql`
        select pg_terminate_backend(pid) from pg_locks where locktype = 'advisory' and objid = 7202609
      `);
      return { status: 200, body: meetingJson(2) };
    });
    // The unlock then fails on the dead session, which the cron route reports as a logged server_error.
    await expect(runSync(60_000)).rejects.toThrow("not queryable");
    expect(await feed(dropped.id)).toMatchObject({ meetingCount: 2, lastError: null });
    expect(log.mock.calls.map((args) => format(...args)).join("\n")).toContain("[sync] lock session error");
  });

  it("brings an opted-out feed's meetings back when it opts in again, even if the feed would answer 304", async () => {
    const returning = await feedServing("returning", (_path, headers) =>
      headers["if-none-match"] === undefined
        ? { status: 200, body: meetingJson(2), headers: { ETag: '"v1"' } }
        : { status: 304 },
    );
    await runSync(60_000);
    await db.update(feeds).set({ optedOut: true }).where(eq(feeds.id, returning.id));
    await runSync(60_000);
    await db
      .update(feeds)
      .set({ optedOut: false, lastSuccessAt: new Date(0), lastAttemptAt: new Date(0) })
      .where(eq(feeds.id, returning.id));
    expect(await runSync(60_000)).toMatchObject({ synced: 1, unchanged: 0 });
    expect(await db.select().from(meetings).where(isNull(meetings.archivedAt))).toHaveLength(2);
  });

  it("fetches a feed whose URL changed right away, without the old URL's validators", async () => {
    const moving = await feedServing("moving", () => ({
      status: 200,
      body: meetingJson(2),
      headers: { ETag: '"v1"', "Last-Modified": "Sat, 26 Sep 2026 10:00:00 GMT" },
    }));
    await runSync(60_000);
    const moved = await startServer(() => ({ status: 200, body: meetingJson(3) }));
    servers.push(moved);
    await upsertFeed({
      slug: "moving",
      name: "moving",
      entityType: "intergroup",
      state: "TN",
      url: `${moved.baseUrl}/new`,
    });
    expect(await runSync(60_000)).toMatchObject({ synced: 1 });
    expect(moved.requests).toHaveLength(1);
    expect(moved.requests[0]?.headers["if-none-match"]).toBeUndefined();
    expect(moved.requests[0]?.headers["if-modified-since"]).toBeUndefined();
    expect(await feed(moving.id)).toMatchObject({ meetingCount: 3 });
  });

  it("re-picks each meeting's primary source on the next sync after a priority change", async () => {
    const conditional = (_path: string, headers: IncomingHttpHeaders) =>
      headers["if-none-match"] === undefined
        ? { status: 200, body: meetingJson(1), headers: { ETag: '"v1"' } }
        : { status: 304 };
    const first = await feedServing("first", conditional);
    const second = await feedServing("second", conditional);
    await runSync(60_000);
    expect(await primaryFeedIds()).toEqual([first.id]);
    await upsertFeed({
      slug: "second",
      name: "second",
      entityType: "intergroup",
      state: "TN",
      url: `${second.server.baseUrl}/second`,
      priority: 5,
    });
    await runSync(60_000);
    expect(await primaryFeedIds()).toEqual([second.id]);
  });

  it("lets only one run happen at a time", async () => {
    await feedServing("slow", () => ({ status: 200, body: meetingJson(1) }));
    const results = await Promise.all([runSync(60_000), runSync(60_000)]);
    expect(results.map((result) => result.status).sort()).toEqual(["done", "locked"]);
  });
});
