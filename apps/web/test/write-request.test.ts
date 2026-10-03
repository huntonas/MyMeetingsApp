import { format } from "node:util";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { deviceDays, devices } from "@/db/schema";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { foldDeviceDays } from "@/server/devices/device-days";
import { identifyDevice, readWriteRequest, writeAsDevice } from "@/server/devices/write-request";

import { resetDb } from "./db";
import { DEVICE_A, DEVICE_A_HASH, DEVICE_B, DEVICE_B_HASH, deviceHeaders } from "./tag-fixtures";

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => pool.end());

// A write route reduced to its header handling.
const write = withErrors(async (req: Request) => {
  const { device } = await readWriteRequest(req, z.object({}));
  await writeAsDevice(device, () => Promise.resolve());
  return jsonResponse(z.object({ deviceHash: z.string() }), device, "none");
});

function call(headers: Record<string, string>) {
  return write(new Request("http://test/api/v1/tags", { method: "POST", headers, body: "{}" }));
}

const utcToday = () => new Date().toISOString().slice(0, 10);

describe("write request headers", () => {
  it("hashes the device id and records the device by date only", async () => {
    const res = await call(deviceHeaders());
    expect(await res.json()).toEqual({ deviceHash: DEVICE_A_HASH });
    expect(await db.select().from(devices)).toEqual([]);
    expect(await db.select().from(deviceDays)).toEqual([
      { deviceHash: DEVICE_A_HASH, day: utcToday(), platform: "ios", attestKeyId: null, attestCounter: null },
    ]);
    await foldDeviceDays();
    expect(await db.select().from(devices)).toEqual([
      {
        deviceHash: DEVICE_A_HASH,
        platform: "ios",
        firstSeenDate: utcToday(),
        lastSeenDate: utcToday(),
        blocked: false,
        attestKeyId: null,
        attestPublicKey: null,
        attestCounter: null,
      },
    ]);
  });

  it("never stores the raw device id", async () => {
    await call(deviceHeaders());
    await foldDeviceDays();
    const { rows } = await db.execute(sql`
      select row_to_json(d)::text as row from devices d
      union all select row_to_json(d)::text from device_days d
    `);
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows).toLowerCase()).not.toContain(DEVICE_A.toLowerCase());
  });

  it("moves last_seen_date forward and keeps first_seen_date, at the nightly fold", async () => {
    await db.insert(devices).values({
      deviceHash: DEVICE_A_HASH,
      platform: "ios",
      firstSeenDate: "2026-01-01",
      lastSeenDate: "2026-01-02",
    });
    await call(deviceHeaders());
    await foldDeviceDays();
    const [row] = await db.select().from(devices);
    expect([row?.firstSeenDate, row?.lastSeenDate]).toEqual(["2026-01-01", utcToday()]);
  });

  it("leaves an existing record's xmin and xmax untouched", async () => {
    await db
      .insert(devices)
      .values({ deviceHash: DEVICE_A_HASH, platform: "ios", lastSeenDate: "2026-01-02" });
    const stamps = async () =>
      (await db.execute<{ xmin: string; xmax: string }>(sql`select xmin::text, xmax::text from devices`))
        .rows;
    const before = await stamps();
    await call(deviceHeaders());
    await call(deviceHeaders());
    expect(await stamps()).toEqual(before);
  });

  it.each<[string, Record<string, string>]>([
    ["a missing device id", { "X-Platform": "ios", "X-App-Version": "1.0.0" }],
    ["a device id too short to be real", { ...deviceHeaders(), "X-Device-Id": "abc" }],
    ["an unknown platform", { ...deviceHeaders(), "X-Platform": "web" }],
    ["a malformed version", { ...deviceHeaders(), "X-App-Version": "1.0" }],
  ])("refuses %s as invalid_request", async (_case, headers) => {
    const res = await call(headers);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(await db.select().from(devices)).toEqual([]);
  });

  it("asks an app below the platform's minimum version to upgrade", async () => {
    vi.stubEnv("MIN_VERSION_IOS", "1.2.0");
    const res = await call({ ...deviceHeaders(), "X-App-Version": "1.1.9" });
    expect(res.status).toBe(426);
    expect(await res.json()).toEqual({
      error: {
        code: "upgrade_required",
        message: "This version of the app is too old. Please update it to keep adding tags.",
      },
    });
  });

  it("compares versions by number, so 1.10.0 is newer than 1.9.0", async () => {
    vi.stubEnv("MIN_VERSION_IOS", "1.9.0");
    vi.stubEnv("MIN_VERSION_ANDROID", "9.0.0");
    expect((await call({ ...deviceHeaders(), "X-App-Version": "1.10.0" })).status).toBe(200);
  });

  it("accepts writes without attestation while REQUIRE_ATTESTATION is off or unset", async () => {
    vi.stubEnv("REQUIRE_ATTESTATION", "off");
    expect((await call(deviceHeaders())).status).toBe(200);
    vi.stubEnv("REQUIRE_ATTESTATION", undefined);
    expect((await call(deviceHeaders())).status).toBe(200);
  });

  it("refuses a write with no valid proof while attestation is required", async () => {
    vi.stubEnv("REQUIRE_ATTESTATION", "on");
    const res = await call({ ...deviceHeaders(), "X-Attestation": "assertion" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "attestation_failed" } });
  });

  it("requires attestation and warns when the switch is neither on nor off", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("REQUIRE_ATTESTATION", "yes");
    expect((await call(deviceHeaders())).status).toBe(401);
    expect(warn.mock.calls.map((args) => format(...args)).join("\n")).toContain(
      'REQUIRE_ATTESTATION should be "on" or "off"',
    );
  });

  it("refuses a blocked device", async () => {
    await db.insert(devices).values({ deviceHash: DEVICE_A_HASH, platform: "ios", blocked: true });
    const res = await call(deviceHeaders());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "device_blocked" } });
  });
});

describe("identifyDevice", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://test/api/v1/attest/challenge", { method: "POST", headers });

  it("hashes each phone's id with its platform, and checks no version", () => {
    vi.stubEnv("MIN_VERSION_IOS", "9.0.0");
    vi.stubEnv("MIN_VERSION_ANDROID", "9.0.0");
    expect(identifyDevice(request(deviceHeaders()))).toEqual({ platform: "ios", deviceHash: DEVICE_A_HASH });
    expect(identifyDevice(request(deviceHeaders(DEVICE_B, "android")))).toEqual({
      platform: "android",
      deviceHash: DEVICE_B_HASH,
    });
  });
});
