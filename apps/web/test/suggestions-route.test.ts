import { format } from "node:util";

import { SuggestionResponse } from "@mymeetingapp/shared";
import { startServer } from "@mymeetingapp/test-server";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/v1/suggestions/route";
import { db, pool } from "@/db/client";
import { aiDecisions, suggestions, tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";

import { resetDb } from "./db";
import { DEVICE_A_HASH, deviceHeaders } from "./tag-fixtures";

const MODEL = "anthropic/claude-haiku-4.5";
const servers: { close: () => Promise<void> }[] = [];

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
afterAll(() => pool.end());

interface Screening {
  decision: "merge" | "reject" | "pending";
  tagSlug: string | null;
  reason: string;
}

// A fake AI Gateway. It answers the gateway provider's POST {baseURL}/language-model with a LanguageModelV4
// generate result whose text is the screening JSON.
async function gateway(reply: Screening | { failWith: number }) {
  const server = await startServer(() =>
    "failWith" in reply
      ? {
          status: reply.failWith,
          body: JSON.stringify({ error: { message: "upstream failed", type: "internal_server_error" } }),
        }
      : {
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content: [{ type: "text", text: JSON.stringify(reply) }],
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 150, noCache: 150, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 20, text: 20, reasoning: 0 },
            },
            warnings: [],
          }),
        },
  );
  servers.push(server);
  vi.stubEnv("AI_GATEWAY_BASE_URL", server.baseUrl);
  vi.stubEnv("AI_GATEWAY_API_KEY", "gateway-test-key");
  vi.stubEnv("SUGGESTION_MODEL", MODEL);
  return server;
}

function suggest(text: unknown, headers = deviceHeaders()) {
  return POST(
    new Request("http://test/api/v1/suggestions", {
      method: "POST",
      headers,
      body: JSON.stringify({ text }),
    }),
  );
}

async function onlySuggestion() {
  const [row] = await db.select().from(suggestions);
  return row;
}

async function tagIdOf(slug: string) {
  const [row] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug));
  return row?.id;
}

describe("POST /api/v1/suggestions", () => {
  it("merges a clear synonym into its tag, logs the decision and unlinks the device", async () => {
    const server = await gateway({
      decision: "merge",
      tagSlug: "laid-back",
      reason: "Same meaning as Laid back.",
    });
    const res = await suggest("Relaxed");
    expect(res.status).toBe(202);
    expect(SuggestionResponse.parse(await res.json())).toEqual({ status: "received" });
    const row = await onlySuggestion();
    expect([row?.text, row?.status, row?.mergedTagId, row?.deviceHash]).toEqual([
      "Relaxed",
      "merged",
      await tagIdOf("laid-back"),
      null,
    ]);
    expect(row?.reviewedAt).toBeInstanceOf(Date);
    const decisions = await db
      .select({
        input: aiDecisions.input,
        decision: aiDecisions.decision,
        tagSlug: aiDecisions.tagSlug,
        reason: aiDecisions.reason,
        model: aiDecisions.model,
      })
      .from(aiDecisions);
    expect(decisions).toEqual([
      {
        input: "Relaxed",
        decision: "merge",
        tagSlug: "laid-back",
        reason: "Same meaning as Laid back.",
        model: MODEL,
      },
    ]);
    const [request] = server.requests;
    expect([request?.method, request?.path, request?.headers["ai-language-model-id"]]).toEqual([
      "POST",
      "/language-model",
      MODEL,
    ]);
    expect(JSON.parse(request?.body ?? "{}")).toMatchObject({
      providerOptions: { gateway: { zeroDataRetention: true } },
    });
  });

  it("rejects a name or judgment and unlinks the device", async () => {
    await gateway({ decision: "reject", tagSlug: null, reason: "Judges the members." });
    await suggest("Boring people");
    const row = await onlySuggestion();
    expect([row?.status, row?.deviceHash]).toEqual(["rejected", null]);
  });

  it("leaves an unclear suggestion pending, still linked to its device", async () => {
    await gateway({ decision: "pending", tagSlug: null, reason: "Could be a new format." });
    await suggest("Candlelight");
    const row = await onlySuggestion();
    expect([row?.status, row?.deviceHash, row?.reviewedAt]).toEqual(["pending", DEVICE_A_HASH, null]);
    expect(await db.select({ decision: aiDecisions.decision }).from(aiDecisions)).toEqual([
      { decision: "pending" },
    ]);
  });

  it("keeps a merge into a tag that doesn't exist pending, but logs it as the AI gave it", async () => {
    await gateway({ decision: "merge", tagSlug: "made-up", reason: "Synonym." });
    await suggest("Chill");
    expect((await onlySuggestion())?.status).toBe("pending");
    expect(await db.select({ tagSlug: aiDecisions.tagSlug }).from(aiDecisions)).toEqual([
      { tagSlug: "made-up" },
    ]);
  });

  it("leaves the suggestion pending and logs no text when the gateway fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await gateway({ failWith: 500 });
    expect((await suggest("Relaxed")).status).toBe(202);
    expect((await onlySuggestion())?.status).toBe("pending");
    expect(await db.select().from(aiDecisions)).toEqual([]);
    const logged = log.mock.calls.map((args) => format(...args)).join("\n");
    expect(logged).toContain("[suggestions] AI screening failed");
    expect(logged).not.toContain("Relaxed");
  });

  it("leaves suggestions pending, with a warning, when no model is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const server = await gateway({ decision: "reject", tagSlug: null, reason: "x" });
    vi.stubEnv("SUGGESTION_MODEL", undefined);
    await suggest("Relaxed");
    expect((await onlySuggestion())?.status).toBe("pending");
    expect(server.requests).toEqual([]);
    expect(warn.mock.calls.map((args) => format(...args)).join("\n")).toContain(
      "SUGGESTION_MODEL is not set",
    );
  });

  it("allows 5 suggestions per device per day", async () => {
    await gateway({ decision: "pending", tagSlug: null, reason: "Unclear." });
    for (let n = 0; n < 5; n++) expect((await suggest(`Idea ${String(n)}`)).status).toBe(202);
    const res = await suggest("Idea 5");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: "rate_limited" } });
  });

  it("refuses text outside 2 to 40 characters", async () => {
    const res = await suggest("x");
    expect(res.status).toBe(400);
    expect(await db.select().from(suggestions)).toEqual([]);
  });

  it("is refused while the suggestions switch is off", async () => {
    vi.stubEnv("FEATURE_SUGGESTIONS", "off");
    const res = await suggest("Relaxed");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "tags_disabled" } });
  });
});
