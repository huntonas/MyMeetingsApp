import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { meetings } from "@/db/schema";
import { taggingWindowOpen } from "@/server/tags/window";

import { resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => pool.end());

interface Meeting {
  day: number;
  time: string;
  timezone: string | null;
}

async function openAt(meeting: Meeting, now: string) {
  const [created] = await db.insert(meetings).values(meeting).returning({ id: meetings.id });
  const [row] = await db
    .select({ open: taggingWindowOpen(new Date(now)) })
    .from(meetings)
    .where(eq(meetings.id, created?.id ?? ""));
  return row?.open;
}

const MONDAY_NOON_UTC = { day: 1, time: "12:00", timezone: "UTC" };
const TUESDAY_7PM_LA = { day: 2, time: "19:00", timezone: "America/Los_Angeles" };
const SATURDAY_8PM_NY = { day: 6, time: "20:00", timezone: "America/New_York" };

describe("taggingWindowOpen", () => {
  it.each<[string, Meeting, string, boolean]>([
    ["opens at the start", MONDAY_NOON_UTC, "2026-09-28T12:00:00Z", true],
    ["is closed a minute before the start", MONDAY_NOON_UTC, "2026-09-28T11:59:00Z", false],
    ["is still open a minute before 36 hours", MONDAY_NOON_UTC, "2026-09-29T23:59:00Z", true],
    ["closes 36 hours after the start", MONDAY_NOON_UTC, "2026-09-30T00:00:00Z", false],
    [
      "uses the local weekday and time: 18:30 in LA is before a 19:00 start",
      TUESDAY_7PM_LA,
      "2026-09-30T01:30:00Z",
      false,
    ],
    ["opens at 19:00 in LA, which is 02:00 UTC the next day", TUESDAY_7PM_LA, "2026-09-30T02:30:00Z", true],
    ["runs 36 real hours across a DST change", SATURDAY_8PM_NY, "2026-03-09T12:30:00Z", true],
    [
      "closes 36 real hours after a start before a DST change",
      SATURDAY_8PM_NY,
      "2026-03-09T13:30:00Z",
      false,
    ],
    [
      "opens after midnight UTC for a late-evening meeting",
      { day: 1, time: "23:00", timezone: "UTC" },
      "2026-09-29T01:00:00Z",
      true,
    ],
    [
      "is never open without a time zone",
      { day: 1, time: "12:00", timezone: null },
      "2026-09-28T12:30:00Z",
      false,
    ],
  ])("%s", async (_case, meeting, now, expected) => {
    expect(await openAt(meeting, now)).toBe(expected);
  });
});
