import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { devices, tagSwings } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";

import { seedSwing } from "./admin-fixtures";
import { resetDb } from "./db";
import { adminGet, formContaining, submitForm } from "./e2e-forms";
import { DEVICE_A_HASH } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

describe("swing review in the built app", () => {
  it("blocks a phone from the flag's review page and returns to it", async () => {
    const { swingId } = await seedSwing();
    expect(await (await adminGet("/metrics/swings")).text()).toContain(
      `href="/metrics/swings/${String(swingId)}"`,
    );
    const path = `/metrics/swings/${String(swingId)}`;
    const html = await (await adminGet(path)).text();
    const res = await submitForm(path, formContaining(html, `Block phone ${DEVICE_A_HASH.slice(0, 12)}`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(new RegExp(`${path}\\?notice=blocked$`));
    const [row] = await db
      .select({ blocked: devices.blocked })
      .from(devices)
      .where(eq(devices.deviceHash, DEVICE_A_HASH));
    expect(row).toEqual({ blocked: true });
  });

  it("closes the flag", async () => {
    const { swingId } = await seedSwing();
    const path = `/metrics/swings/${String(swingId)}`;
    const res = await submitForm(
      path,
      formContaining(await (await adminGet(path)).text(), "Close this flag"),
    );
    expect(res.headers.get("location")).toMatch(/\/metrics\/swings\?notice=closed$/);
    const [row] = await db.select({ reviewedAt: tagSwings.reviewedAt }).from(tagSwings);
    expect(row?.reviewedAt).toBeInstanceOf(Date);
  });

  it("answers 404 for a flag that doesn't exist, even past Postgres's integer range", async () => {
    expect((await adminGet("/metrics/swings/999")).status).toBe(404);
    expect((await adminGet("/metrics/swings/9999999999")).status).toBe(404);
  });

  it("sends a tampered form back to the overview, having blocked nothing", async () => {
    const { swingId } = await seedSwing();
    const path = `/metrics/swings/${String(swingId)}`;
    const fields = formContaining(
      await (await adminGet(path)).text(),
      `Block phone ${DEVICE_A_HASH.slice(0, 12)}`,
    );
    const res = await submitForm(path, { ...fields, deviceHash: "not-a-hash" });
    expect(res.headers.get("location")).toMatch(/\/metrics\?notice=invalid_form$/);
    const [row] = await db
      .select({ blocked: devices.blocked })
      .from(devices)
      .where(eq(devices.deviceHash, DEVICE_A_HASH));
    expect(row).toEqual({ blocked: false });
  });
});
