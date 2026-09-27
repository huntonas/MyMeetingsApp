import { describe, expect, it } from "vitest";

import { withVerifiedTls } from "@/db/connection-url";

describe("withVerifiedTls", () => {
  it.each(["require", "prefer", "verify-ca"])("upgrades sslmode=%s to verify-full", (mode) => {
    expect(
      withVerifiedTls(`postgresql://u:p@ep-x-pooler.neon.tech/db?sslmode=${mode}&channel_binding=require`),
    ).toBe("postgresql://u:p@ep-x-pooler.neon.tech/db?sslmode=verify-full&channel_binding=require");
  });

  it.each([
    "postgres://mma:mma@localhost:5433/mma_test",
    "postgresql://u:p@host/db?sslmode=verify-full",
    "postgresql://u:p@host/db?sslmode=disable",
  ])("leaves %s unchanged", (url) => {
    expect(withVerifiedTls(url)).toBe(url);
  });

  it("keeps a missing URL missing", () => {
    expect(withVerifiedTls(undefined)).toBeUndefined();
  });

  it("keeps percent-encoded passwords intact", () => {
    expect(withVerifiedTls("postgresql://u:p%40ss@host/db?sslmode=require")).toBe(
      "postgresql://u:p%40ss@host/db?sslmode=verify-full",
    );
  });
});
