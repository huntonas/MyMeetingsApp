import { eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { feedMeetings, feeds, meetings } from "@/db/schema";
import { upsertFeed } from "@/db/upsert-feed";
import { runSync } from "@/server/sync/run-sync";

import { resetDb } from "./db";
import { startServer } from "./http-server";

const servers: { close(): Promise<void> }[] = [];
beforeEach(resetDb);
afterEach(async () => {
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

async function feedServing(
  slug: string,
  reply: () => { status: number; body?: string; headers?: Record<string, string> },
) {
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

  it("lets only one run happen at a time", async () => {
    await feedServing("slow", () => ({ status: 200, body: meetingJson(1) }));
    const results = await Promise.all([runSync(60_000), runSync(60_000)]);
    expect(results.map((result) => result.status).sort()).toEqual(["done", "locked"]);
  });
});
