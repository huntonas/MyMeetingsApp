import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { meetings } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";

import { resetDb } from "./db";
import { adminGet, formContaining, submitForm } from "./e2e-forms";
import { seedMeetingStarted } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

describe("opt-outs in the built app", () => {
  it("finds a meeting and turns its tags off", async () => {
    const meetingId = await seedMeetingStarted(1);
    const html = await (await adminGet("/metrics/opt-outs?q=Nooners")).text();
    const res = await submitForm("/metrics/opt-outs", formContaining(html, "Turn tags off for Nooners"));
    expect(res.headers.get("location")).toMatch(/\/metrics\/opt-outs\?notice=tags_turned_off$/);
    const [row] = await db
      .select({ tagsDisabled: meetings.tagsDisabled })
      .from(meetings)
      .where(eq(meetings.id, meetingId));
    expect(row).toEqual({ tagsDisabled: true });
    expect(await (await adminGet("/metrics/opt-outs")).text()).toContain("Turn tags back on for Nooners");
  });
});
