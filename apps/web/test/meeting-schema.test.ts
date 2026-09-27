import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { feeds, meetingLocation, meetings } from "@/db/schema";

import { resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => pool.end());

describe("meetings.location", () => {
  it("is generated from latitude and longitude and supports radius queries", async () => {
    const [near] = await db
      .insert(meetings)
      .values({ day: 1, time: "12:00", latitude: 36.17, longitude: -86.78 })
      .returning();
    await db.insert(meetings).values({ day: 1, time: "12:00", latitude: 40.0, longitude: -86.78 });
    await db.insert(meetings).values({ day: 1, time: "12:00" });

    const center = sql`ST_SetSRID(ST_MakePoint(-86.78, 36.16), 4326)::geography`;
    const rows = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(sql`ST_DWithin(${meetingLocation}, ${center}, 5000)`);

    expect(rows).toEqual([{ id: near?.id }]);
  });
});

describe("feeds table", () => {
  const feed = {
    slug: "x",
    name: "X",
    entityType: "intergroup",
    state: "TN",
    url: "https://x.org/f",
    priority: 10,
  } as const;

  it("rejects a lowercase or long state code", async () => {
    const insert = db.insert(feeds).values({ ...feed, state: "tn" });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "feeds_state_check" } });
  });

  it("rejects an unknown entity type", async () => {
    // @ts-expect-error -- deliberately invalid entity type, to exercise the database constraint
    const insert = db.insert(feeds).values({ ...feed, entityType: "club" });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "feeds_entity_type_check" } });
  });
});
