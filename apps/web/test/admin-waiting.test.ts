import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { feeds } from "@/db/schema";
import {
  listWaitingFeeds,
  OutreachForm,
  resumeFeed,
  saveOutreach,
  waitForPermission,
  WaitForm,
} from "@/server/admin/waiting";

import { formData } from "./admin-fixtures";
import { resetDb } from "./db";
import { seedFeed } from "./feed-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

async function feedRow(id: number) {
  const [row] = await db.select().from(feeds).where(eq(feeds.id, id));
  return row;
}

describe("waiting for an office's permission", () => {
  it("pauses a feed with its reason and lists it", async () => {
    const feedId = await seedFeed("houston-intergroup");
    await seedFeed("knox-intergroup");

    expect(await waitForPermission({ feedId, reason: "bot_check" })).toBe("feed_waiting");
    expect(await listWaitingFeeds()).toEqual([
      expect.objectContaining({ id: feedId, slug: "houston-intergroup", waitingReason: "bot_check" }),
    ]);
  });

  it("saves the outreach, blank fields clearing what was there", async () => {
    const feedId = await seedFeed("western-colorado");
    await waitForPermission({ feedId, reason: "restricted" });

    const filled = OutreachForm.parse(
      Object.fromEntries(
        formData({
          feedId: String(feedId),
          contactEmail: " contact@aa-westerncolorado.example ",
          contactedOn: "2026-10-05",
          outreachNote: "Asked for a sharing key.",
          accessKey: " k3y ",
        }),
      ),
    );
    expect(await saveOutreach(filled)).toBe("outreach_saved");
    expect(await feedRow(feedId)).toMatchObject({
      contactEmail: "contact@aa-westerncolorado.example",
      contactedOn: "2026-10-05",
      outreachNote: "Asked for a sharing key.",
      accessKey: "k3y",
      waitingReason: "restricted",
    });

    const blank = OutreachForm.parse({
      feedId: String(feedId),
      contactEmail: "",
      contactedOn: "",
      outreachNote: " ",
      accessKey: "",
    });
    await saveOutreach(blank);
    expect(await feedRow(feedId)).toMatchObject({
      contactEmail: null,
      contactedOn: null,
      outreachNote: null,
      accessKey: null,
    });
  });

  it("refuses an outreach form with a malformed email or date", () => {
    const fields = { feedId: "1", contactEmail: "", contactedOn: "", outreachNote: "", accessKey: "" };
    expect(OutreachForm.safeParse({ ...fields, contactEmail: "not an email" }).success).toBe(false);
    expect(OutreachForm.safeParse({ ...fields, contactedOn: "10/05/2026" }).success).toBe(false);
  });

  it("resumes a feed so the next sync fetches it at once, keeping the outreach", async () => {
    const feedId = await seedFeed("houston-intergroup");
    await db
      .update(feeds)
      .set({
        waitingReason: "bot_check",
        contactEmail: "intergroup@houston.example",
        lastAttemptAt: new Date(),
        lastSuccessAt: new Date(0),
        lastError: "blocked by a bot check (Cloudflare)",
      })
      .where(eq(feeds.id, feedId));

    expect(await resumeFeed({ feedId })).toBe("feed_resumed");
    expect(await feedRow(feedId)).toMatchObject({
      waitingReason: null,
      contactEmail: "intergroup@houston.example",
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
    });
    expect(await listWaitingFeeds()).toEqual([]);
  });

  it("says so when the feed no longer exists", async () => {
    expect(await waitForPermission({ feedId: 999, reason: "restricted" })).toBe("feed_not_found");
    expect(await resumeFeed({ feedId: 999 })).toBe("feed_not_found");
    expect(
      await saveOutreach({
        feedId: 999,
        contactEmail: null,
        contactedOn: null,
        outreachNote: null,
        accessKey: null,
      }),
    ).toBe("feed_not_found");
  });

  it("reads the wait form's reason", () => {
    expect(WaitForm.parse({ feedId: "3", reason: "restricted" })).toEqual({
      feedId: 3,
      reason: "restricted",
    });
    expect(WaitForm.safeParse({ feedId: "3", reason: "opted_out" }).success).toBe(false);
  });
});
