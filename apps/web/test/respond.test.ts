import { format } from "node:util";

import { VocabularyResponse } from "@mymeetingapp/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, jsonResponse, withErrors } from "@/lib/api/respond";

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
    expect(() => jsonResponse(VocabularyResponse, broken as never, "none")).toThrow();
  });
});

describe("apiError", () => {
  it("sends the error envelope with its status and no caching", async () => {
    const res = apiError("server_error");
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: {
        code: "server_error",
        message: "Something went wrong on our end. Please try again in a few minutes.",
      },
    });
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

  it("turns a thrown error into server_error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await failing(new Request("http://test/api"));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: "server_error" } });
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
});
