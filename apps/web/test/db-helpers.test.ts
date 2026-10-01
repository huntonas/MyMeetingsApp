import { afterAll, describe, expect, it } from "vitest";

import { pool } from "@/db/client";

import { whileHolding } from "./db";

afterAll(async () => {
  await pool.end();
});

describe("whileHolding", () => {
  it("frees its connection and its locks when the test body throws", async () => {
    const idleBefore = pool.idleCount;
    // Checked out before whileHolding runs, so the pool (LIFO) can't hand this same session back to whileHolding's
    // own client: the check below always runs on a different backend, able to see a lock a skipped rollback left
    // held (advisory locks are re-entrant within one session, so the same session would see it as free).
    const other = await pool.connect();
    try {
      await expect(
        whileHolding("select pg_advisory_xact_lock(424242)", [], () =>
          Promise.reject(new Error("assertion failed")),
        ),
      ).rejects.toThrow("assertion failed");
      const { rows } = await other.query<{ got: boolean }>("select pg_try_advisory_lock(424242) as got");
      expect(rows).toEqual([{ got: true }]);
      await other.query("select pg_advisory_unlock(424242)");
    } finally {
      other.release();
    }
    expect(pool.idleCount).toBeGreaterThanOrEqual(idleBefore);
  });
});
