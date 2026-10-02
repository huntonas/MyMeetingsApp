import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { devices } from "@/db/schema";

import { resetDb } from "./db";
import { DEVICE_A_HASH, DEVICE_B_HASH } from "./tag-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

const KEY_ID = "zgSY9YSD+7TaDXssY6WlOPVS1K3Lmk+pFhlcSWE+ZV0=";

describe("a phone's App Attest key", () => {
  it("is stored whole or not at all", async () => {
    await expect(
      db.insert(devices).values({ deviceHash: DEVICE_A_HASH, platform: "ios", attestKeyId: KEY_ID }),
    ).rejects.toMatchObject({ cause: { constraint: "devices_attest_check" } });
  });

  it("belongs to one phone only", async () => {
    const key = { attestKeyId: KEY_ID, attestPublicKey: "MFkw", attestCounter: 0 };
    await db.insert(devices).values({ deviceHash: DEVICE_A_HASH, platform: "ios", ...key });
    await expect(
      db.insert(devices).values({ deviceHash: DEVICE_B_HASH, platform: "ios", ...key }),
    ).rejects.toMatchObject({ cause: { constraint: "devices_attest_key_idx" } });
  });
});
