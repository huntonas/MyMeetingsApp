import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { devices, tagSubmissions } from "@/db/schema";

import { resetDb } from "./db";
import { seedDuplicateCopies } from "./tag-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

describe("tagging schema", () => {
  it("accepts only 64-hex submitter ids", async () => {
    const { older } = await seedDuplicateCopies();
    const insert = db.insert(tagSubmissions).values({
      meetingId: older,
      submitterId: "6F9619FF-8B86-D011-B42D-00C04FC964FF",
      scopeMeetingId: older,
      tagIds: [1],
      nearMeeting: false,
    });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "tag_submissions_submitter_check" } });
  });

  it("stores 1 to 6 tags per submission", async () => {
    const { older } = await seedDuplicateCopies();
    const insert = db.insert(tagSubmissions).values({
      meetingId: older,
      submitterId: "a".repeat(64),
      scopeMeetingId: older,
      tagIds: [1, 2, 3, 4, 5, 6, 7],
      nearMeeting: false,
    });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "tag_submissions_tag_ids_check" } });
  });

  it("stores devices only for known platforms", async () => {
    // @ts-expect-error -- deliberately invalid platform, to exercise the database constraint
    const insert = db.insert(devices).values({ deviceHash: "a".repeat(64), platform: "web" });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "devices_platform_check" } });
  });
});
