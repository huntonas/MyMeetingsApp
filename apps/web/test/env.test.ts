import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadLocalEnvFile, readEnv } from "@/env";

const startDir = process.cwd();

afterEach(() => {
  vi.unstubAllEnvs();
  process.chdir(startDir);
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

describe("loadLocalEnvFile", () => {
  function inTempDir(files: Record<string, string>) {
    const dir = mkdtempSync(path.join(tmpdir(), "mma-env-"));
    for (const [name, contents] of Object.entries(files)) writeFileSync(path.join(dir, name), contents);
    process.chdir(dir);
  }

  it("loads variables from .env.local in the working directory", () => {
    vi.stubEnv("DATABASE_URL", undefined);
    inTempDir({ ".env.local": "DATABASE_URL=postgres://from-file\n" });
    loadLocalEnvFile();
    expect(readEnv("DATABASE_URL")).toBe("postgres://from-file");
  });

  it("never overrides a variable that is already set", () => {
    vi.stubEnv("DATABASE_URL", "postgres://real");
    inTempDir({ ".env.local": "DATABASE_URL=postgres://from-file\n" });
    loadLocalEnvFile();
    expect(readEnv("DATABASE_URL")).toBe("postgres://real");
  });

  it("does nothing when there is no .env.local", () => {
    vi.stubEnv("DATABASE_URL", undefined);
    inTempDir({});
    expect(() => {
      loadLocalEnvFile();
    }).not.toThrow();
    expect(readEnv("DATABASE_URL")).toBeUndefined();
  });
});
