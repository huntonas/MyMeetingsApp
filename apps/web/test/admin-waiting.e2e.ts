import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { feeds } from "@/db/schema";

import { resetDb } from "./db";
import { adminGet, formContaining, submitForm } from "./e2e-forms";
import { seedFeed } from "./feed-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

async function feedRow(id: number) {
  const [row] = await db
    .select({
      waitingReason: feeds.waitingReason,
      contactEmail: feeds.contactEmail,
      contactedOn: feeds.contactedOn,
      accessKey: feeds.accessKey,
    })
    .from(feeds)
    .where(eq(feeds.id, id));
  return row;
}

describe("feeds waiting for permission in the built app", () => {
  it("pauses a blocked feed from the overview, records the outreach, and resumes it", async () => {
    const feedId = await seedFeed("houston-intergroup");
    await db
      .update(feeds)
      .set({ lastAttemptAt: new Date(), lastError: "blocked by a bot check (Cloudflare)" })
      .where(eq(feeds.id, feedId));

    const overview = await (await adminGet("/metrics")).text();
    const paused = await submitForm(
      "/metrics",
      formContaining(overview, "Wait for permission: houston-intergroup"),
    );
    expect(paused.headers.get("location")).toMatch(/\/metrics\/waiting\?notice=feed_waiting$/);
    expect(await feedRow(feedId)).toMatchObject({ waitingReason: "bot_check" });
    expect(await (await adminGet("/metrics")).text()).not.toContain("blocked by a bot check (Cloudflare)");

    const waiting = await (await adminGet("/metrics/waiting")).text();
    const saved = await submitForm("/metrics/waiting", {
      ...formContaining(waiting, "Outreach: houston-intergroup"),
      contactEmail: "intergroup@houston.example",
      contactedOn: "2026-10-05",
    });
    expect(saved.headers.get("location")).toMatch(/\/metrics\/waiting\?notice=outreach_saved$/);
    expect(await feedRow(feedId)).toMatchObject({
      contactEmail: "intergroup@houston.example",
      contactedOn: "2026-10-05",
      accessKey: null,
    });

    const after = await (await adminGet("/metrics/waiting")).text();
    expect(after).toContain('value="intergroup@houston.example"');
    const resumed = await submitForm("/metrics/waiting", formContaining(after, "Resume: houston-intergroup"));
    expect(resumed.headers.get("location")).toMatch(/\/metrics\/waiting\?notice=feed_resumed$/);
    expect(await feedRow(feedId)).toMatchObject({ waitingReason: null });
  });
});
