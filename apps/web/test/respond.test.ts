import { format } from "node:util";

import { VocabularyResponse } from "@mymeetingapp/shared";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { tags } from "@/db/schema";
import { jsonResponse, withErrors } from "@/lib/api/respond";

import { resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => pool.end());

afterEach(() => {
  vi.restoreAllMocks();
});

const tag = { slug: "laid-back", label: "Laid back", category: "format" } as const;

describe("jsonResponse", () => {
  it("sends the data with status 200 and the cache policy's header", async () => {
    const res = jsonResponse(VocabularyResponse, { tags: [tag] }, "none");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ tags: [tag] });
  });

  it("strips fields the contract doesn't name", async () => {
    const withInternalField = { tags: [{ ...tag, id: 7, status: "active" }] };
    const res = jsonResponse(VocabularyResponse, withInternalField, "none");
    expect(await res.json()).toEqual({ tags: [tag] });
  });

  it("throws when the data breaks the contract", () => {
    const broken = { tags: [{ ...tag, category: "vibes" }] };
    // @ts-expect-error -- deliberately breaks the contract
    expect(() => jsonResponse(VocabularyResponse, broken, "none")).toThrow();
  });
});

describe("withErrors", () => {
  const failing = withErrors((_req: Request) => Promise.reject(new Error("boom")));

  it("passes a successful response through", async () => {
    const handler = withErrors((_req: Request) =>
      Promise.resolve(jsonResponse(VocabularyResponse, { tags: [] }, "none")),
    );
    const res = await handler(new Request("http://test/api"));
    expect(await res.json()).toEqual({ tags: [] });
  });

  it("accepts a handler that returns its response directly", async () => {
    const handler = withErrors((_req: Request) => jsonResponse(VocabularyResponse, { tags: [] }, "none"));
    const res = await handler(new Request("http://test/api"));
    expect(await res.json()).toEqual({ tags: [] });
  });

  it("catches an error thrown synchronously by the handler", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = withErrors((_req: Request): Response => {
      throw new Error("sync boom");
    });
    const res = await handler(new Request("http://test/api"));
    expect(res.status).toBe(500);
  });

  it("turns a thrown error into the server_error envelope, never cached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await failing(new Request("http://test/api"));
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: {
        code: "server_error",
        message: "Something went wrong on our end. Please try again in a few minutes.",
      },
    });
  });

  it("turns a contract violation into server_error instead of sending bad data", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = withErrors((_req: Request) =>
      Promise.resolve(jsonResponse(VocabularyResponse, { tags: [{ ...tag, slug: "Bad Slug" }] }, "none")),
    );
    const res = await handler(new Request("http://test/api"));
    expect(res.status).toBe(500);
  });

  it("logs the error but never the request's headers", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await failing(new Request("http://test/api", { headers: { "X-Device-Id": "raw-device-id-123" } }));
    // format() renders arguments exactly as the console prints them.
    const logged = log.mock.calls.map((args) => format(...args)).join("\n");
    expect(logged).toContain("boom");
    expect(logged).not.toContain("raw-device-id-123");
  });

  it("never logs a failed query's parameters, which can carry coordinates or device IDs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tag = { slug: "coffee", label: "Coffee", category: "practical", sortOrder: 1 } as const;
    await db.insert(tags).values(tag);
    const duplicateInsert = withErrors(async (_req: Request) => {
      await db.insert(tags).values({ ...tag, label: "36.16,-86.78 device-hash-abc" });
      return jsonResponse(VocabularyResponse, { tags: [] }, "none");
    });

    const res = await duplicateInsert(new Request("http://test/api"));

    expect(res.status).toBe(500);
    const logged = log.mock.calls.map((args) => format(...args)).join("\n");
    expect(logged).toContain("tags_slug_unique");
    expect(logged).not.toContain("36.16,-86.78");
    expect(logged).not.toContain("device-hash-abc");
  });

  it("never logs a value the database quotes back in its own error message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const badCast = withErrors(async (_req: Request) => {
      await db.execute(sql`select ${"36.16 device-hash-abc"}::double precision`);
      return jsonResponse(VocabularyResponse, { tags: [] }, "none");
    });

    const res = await badCast(new Request("http://test/api"));

    expect(res.status).toBe(500);
    const logged = log.mock.calls.map((args) => format(...args)).join("\n");
    expect(logged).toContain("22P02"); // invalid_text_representation
    expect(logged).not.toContain("device-hash-abc");
  });
});
