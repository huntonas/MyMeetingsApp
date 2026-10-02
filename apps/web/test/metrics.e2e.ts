import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { feeds } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";

import { resetDb } from "./db";
import { adminGet } from "./e2e-forms";
import { seedFeed } from "./feed-fixtures";
import { DEVICE_A_HASH, deviceHeaders, seedMeetingStarted } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

describe("/metrics in the built app", () => {
  it("shows totals and the failing feed, and nothing that identifies a phone (spec §14)", async () => {
    const meetingId = await seedMeetingStarted(1);
    const tagged = await POST(
      new Request("http://test/api/v1/tags", {
        method: "POST",
        headers: deviceHeaders(),
        body: JSON.stringify({ meetingId, tags: ["quiet"] }),
      }),
    );
    expect(tagged.status).toBe(201);
    await seedFeed("broken-feed");
    await db
      .update(feeds)
      .set({ lastAttemptAt: new Date(), lastError: "HTTP 503 from the feed" })
      .where(eq(feeds.slug, "broken-feed"));

    const res = await adminGet("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expect(html).toContain("<title>Metrics · My Meeting App</title>");
    expect(html).toMatch(/<a class="wordmark" href="\/metrics">My Meeting App<!-- --> metrics<\/a>/);
    expect(html).toContain("broken-feed");
    expect(html).toContain("HTTP 503 from the feed");
    expect(html).not.toContain(DEVICE_A_HASH.slice(0, 12));
  });
});
