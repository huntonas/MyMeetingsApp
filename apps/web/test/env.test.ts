import { afterEach, describe, expect, it, vi } from "vitest";

import { readEnv } from "@/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readEnv", () => {
  it("returns the value", () => {
    vi.stubEnv("DATABASE_URL", "postgres://example");
    expect(readEnv("DATABASE_URL")).toBe("postgres://example");
  });

  it("trims surrounding whitespace", () => {
    vi.stubEnv("DATABASE_URL", "  postgres://example \n");
    expect(readEnv("DATABASE_URL")).toBe("postgres://example");
  });

  it.each(["", "   "])("treats %j as unset", (value) => {
    vi.stubEnv("DATABASE_URL", value);
    expect(readEnv("DATABASE_URL")).toBeUndefined();
  });

  it("returns undefined when the variable is missing", () => {
    vi.stubEnv("DATABASE_URL", undefined);
    expect(readEnv("DATABASE_URL")).toBeUndefined();
  });
});
