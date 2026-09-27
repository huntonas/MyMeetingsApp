# Phase 7: Feed Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone tool (`tools/feed-discovery`) that builds a verified registry of every US A.A. service entity with a usable meeting feed, writes a per-state coverage report, and loads the verified feeds into the `feeds` table.

**Architecture:**

- The tool fetches aa.org's "A.A. Near You" directory one page per state and parses entities from the HTML.
- For each entity website it detects a feed in the spec's order, verifies it, and records restricted feeds without trying to get around them.
- It writes `registry.yaml` and `coverage.md`, including overlaps and changes since the last run.
- All network access goes through one polite crawler:
  - robots.txt is checked for every hop, including redirects;
  - at most 1 request per second per host;
  - a descriptive User-Agent;
  - a timeout on every request;
  - no retries.
- **Shared code:** the throttle, the User-Agent, address normalization and the registry schema move into a new `packages/feed-kit`, so the web sync and the tool share one implementation. The real-HTTP test server moves into `packages/test-server` for the same reason.
- **Seeding:** a web script loads verified registry entries into `feeds`.
- **Monthly refresh:** a scheduled GitHub Action re-runs discovery and opens a pull request.

**Tech Stack:** Node 24, TypeScript, `node-html-parser`, `robots-parser` 3.0.1 (MIT), `yaml` 2.9.x (ISC), zod 4, Vitest, GitHub Actions.

**Spec:** `SPEC.md` §4 (and §3 for the `feeds` table). Roadmap: `docs/superpowers/plans/2026-09-26-roadmap.md`. Standards: `docs/standards.md` (binding).

**Depends on:** Phase 2 merged. It uses `upsertFeed`, `createHostThrottle`, `addressKey` and the `feeds` table.

## Decisions this plan makes (confirm at review)

1. **Master list = aa.org per-state pages.**
   - Source: `https://www.aa.org/find-aa/north-america?state=XX`, one GET per state or territory, about 56 in total.
   - The pages are server-rendered HTML with no pagination.
   - robots.txt allows `/find-aa`, and the terms of use don't mention automated access.
   - The directory is used as an internal crawl list and not republished.
   - **You may want to ask ippolicy@aa.org** before relying on it, since directory reuse isn't addressed anywhere (research 2026-09-27).
2. **Entity type is inferred from the name.** aa.org has no type field.
   - "Intergroup"/"Intergrupo" becomes `intergroup`.
   - "Central Office", "Central Service", "Oficina Central" and "Service Office" become `central_office`.
   - "District"/"Distrito" becomes `district`.
   - Area footer links become `area`.
   - Anything else (mostly answering services) becomes `intergroup`, with a note saying the type was inferred.
3. **Districts are mostly absent from aa.org.** District discovery beyond what the directory lists is a manual backlog, and so is everything else in `none_found`.
4. **BMLT is manual.** AA entities rarely use BMLT, and a BMLT feed URL needs service-body ids that can't be discovered reliably. A page that references `client_interface` gets `none_found` with the note "BMLT suspected".
5. **A feed URL with an embedded sharing key (`key=`) counts as `restricted`.** The key is the site owner's private credential and is never used.
6. **The registry keeps one manual field across runs:** `opted_out: true` (spec §4, "honor any opt-out"). Seeding sets `feeds.opted_out` for those entries.
7. **One way to share code:**
   - `packages/feed-kit` holds the throttle, `USER_AGENT`, `addressKey` and the `RegistryEntry` schema.
   - `packages/test-server` holds the real local HTTP server used by tests.
   - Phase 2 code moves onto both packages. Nothing is copied.
8. **The first full run needs your go-ahead.** It sends requests to about 700 third-party sites, so the tool is built and tested first, then run once you say so. No one is asked for permission first (spec §4, good-citizen rules).

## Global Constraints

- Everything in `docs/standards.md`:
  - `pnpm check` on every commit, and `pnpm knip:production` at the end of the phase.
  - Test-driven, no dead code, and one way per concern.
- Spec §4 politeness:
  - respect robots.txt;
  - at most one request per second per host;
  - a descriptive User-Agent with the contact email admin@goodersoftwarellc.com;
  - a timeout on every request;
  - never hammer a site with retries.
- Spec §4 detection order: TSML REST feed, then TSML legacy AJAX feed, then a Meeting Guide JSON link on the site, then a Google Sheet, then BMLT, then none found.
- Spec §4 verification: `verified` only after fetching the feed and confirming it's a JSON array of meetings with at least `slug`, `name`, `day` and `time`. Record the meeting count and the states the meetings fall in.
- Spec §4: restricted feeds are recorded as `restricted` and never bypassed, and the report lists them as "contact the intergroup".
- Spec §4 output: `tools/feed-discovery/registry.yaml` with the spec's keys, `coverage.md` with the per-state summary and overlapping feeds, and a seed script loading verified feeds with priorities (intergroup/district before area).
- Spec §4 re-verification: flag feeds that stop responding, new entities in the directory, and meeting-count drops over 30%.
- Nothing is logged except counts and entity ids. The tool never logs feed contents or response bodies.
- Commit trailers: the attribution lines from the committing agent's own instructions.

## Review Focus

1. **A path robots.txt disallows is never requested,** including when a redirect points to it. Pinned in Task 3.
2. **A restricted feed** (TSML 403 `feed_restricted`, AJAX 401, an embedded `key=`, or TSML meta without an open feed) is recorded as `restricted`, and no further guesses are made on that site. Pinned in Task 5.
3. **Re-running keeps a manual `opted_out: true`,** and seeding marks that feed opted out. Pinned in Tasks 7 and 9.
4. **A feed over 50 MB is rejected without being held in memory,** while a normal 3–4 MB feed is fine. Pinned in Task 3.
5. **A directory entity without a website** still appears in the registry and coverage report as `none_found`, with the note "no website listed". Pinned in Task 4.

---

## File structure

```
packages/test-server/        startServer() — real local HTTP server for tests (moved from apps/web/test/http-server.ts)
packages/feed-kit/src/
  throttle.ts                createHostThrottle() (moved from apps/web)
  user-agent.ts              USER_AGENT (moved from apps/web fetch-feed.ts)
  address.ts                 addressKey() (moved from apps/web)
  registry.ts                RegistryEntry schema, FEED_TYPES, ENTITY_TYPES
tools/feed-discovery/
  package.json, tsconfig.json, vitest.config.ts
  src/crawler.ts             createCrawler(): robots + throttle + UA + timeout + size cap + manual redirects
  src/states.ts              US_STATES (code ↔ name)
  src/directory.ts           parseDirectoryPage(html, state)
  src/detect.ts              detectFeed(website, crawler)
  src/verify.ts              verifyFeed(body)
  src/registry-file.ts       readRegistry(), writeRegistry()
  src/report.ts              buildRegistry(), computeOverlaps(), computeChanges(), renderCoverage()
  src/main.ts                CLI: pnpm --filter feed-discovery discover
  registry.yaml, coverage.md (outputs, committed)
apps/web/src/db/seed-feeds.ts, apps/web/scripts/seed-feeds.ts
.github/workflows/feed-discovery.yml
docs/feed-discovery.md       runbook
```

---

### Task 1: Move the test HTTP server into `packages/test-server`

**Files:**

- Create: `packages/test-server/package.json`, `packages/test-server/tsconfig.json`, `packages/test-server/src/index.ts` (the moved contents of `apps/web/test/http-server.ts`)
- Delete: `apps/web/test/http-server.ts`
- Modify: every web test importing `./http-server` (`fetch-feed.test.ts`, `geocode.test.ts`, `run-sync.test.ts`), `apps/web/package.json` (add the devDependency), `knip.json`

**Interfaces:**

- Produces: `startServer(handler)` from `@mymeetingapp/test-server`, with a signature identical to today's helper.

This is a pure move, with no behaviour change. The existing tests that use the helper are its tests.

- [ ] **Step 1: Create the package.** `packages/test-server/package.json`:

```json
{
  "name": "@mymeetingapp/test-server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

For `tsconfig.json`, extend `../../tsconfig.base.json` with `"compilerOptions": { "types": ["node"] }` and `"include": ["src"]`. Run `pnpm --filter @mymeetingapp/test-server add -D @types/node@24`. Then `git mv apps/web/test/http-server.ts packages/test-server/src/index.ts` (the contents are unchanged).

- [ ] **Step 2: Rewire the web tests.**
  - Run `pnpm --filter web add -D "@mymeetingapp/test-server@workspace:*"`.
  - In each web test, replace `from "./http-server"` with `from "@mymeetingapp/test-server"`.
  - In `knip.json`, add a workspace entry `"packages/test-server": { "project": ["src/**/*.ts"] }`, without the `!` production marker, because it's test-only infrastructure.
- [ ] **Step 3: Run** `pnpm check && pnpm knip:production`. Expected: PASS, with the same test count as before the move.
- [ ] **Step 4: Commit** with the message `refactor(test): move the real HTTP test server into packages/test-server`.

---

### Task 2: Move shared crawl and address code into `packages/feed-kit`

**Files:**

- Create: `packages/feed-kit/{package.json,tsconfig.json}`, `packages/feed-kit/src/{index.ts,throttle.ts,user-agent.ts,address.ts,registry.ts}`, `packages/feed-kit/test/{throttle.test.ts,address.test.ts,registry.test.ts}`
- Delete: `apps/web/src/server/feeds/throttle.ts`, `apps/web/src/server/feeds/address.ts`, `apps/web/test/address.test.ts`
- Modify: the web imports of `createHostThrottle`, `HostThrottle`, `USER_AGENT` and `addressKey` (`fetch-feed.ts`, `geocode.ts`, `run-sync.ts`, `normalize.ts`, plus the matching tests); `apps/web/package.json`; `knip.json` if needed

**Interfaces:**

- Produces, from `@mymeetingapp/feed-kit`:
  - `createHostThrottle()` and `HostThrottle`: unchanged behaviour.
  - `USER_AGENT`: the same string as today.
  - `addressKey(address)`: unchanged.
  - `FEED_TYPES = ["tsml","meeting_guide_json","google_sheet","bmlt","none_found","restricted"] as const`.
  - `REGISTRY_ENTITY_TYPES = ["area","district","intergroup","central_office"] as const`.
  - `RegistryEntry`, a zod schema and a type with the spec §4 keys: `id`, `name`, `entity_type`, `state`, `website`, `feed_type`, `feed_url`, `verified`, `meeting_count`, `states_covered`, `checked_at` (`YYYY-MM-DD`), `notes`, and optional `opted_out`.

- [ ] **Step 1: Failing tests for the new pieces.** The moved pieces keep their existing tests: move `apps/web/test/address.test.ts` to `packages/feed-kit/test/address.test.ts`, importing from `../src/index`. Then write `packages/feed-kit/test/throttle.test.ts` from the "waits a second between requests to the same host" case in `fetch-feed.test.ts`, calling `throttle.wait(host)` directly and timing it: the same host waits about 1000 ms or more, and a different host waits under 50 ms. Remove that case from `fetch-feed.test.ts`. Then write `packages/feed-kit/test/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { RegistryEntry } from "../src/index";

const entry = {
  id: "some-county-intergroup-tn",
  name: "Some County Intergroup",
  entity_type: "intergroup",
  state: "TN",
  website: "https://example.org",
  feed_type: "tsml",
  feed_url: "https://example.org/wp-json/tsml/meetings",
  verified: true,
  meeting_count: 612,
  states_covered: ["TN"],
  checked_at: "2026-09-25",
  notes: "",
};

describe("RegistryEntry", () => {
  it("accepts the spec's example entry", () => {
    expect(RegistryEntry.parse(entry)).toEqual(entry);
  });

  it("keeps a manual opt-out", () => {
    expect(RegistryEntry.parse({ ...entry, opted_out: true }).opted_out).toBe(true);
  });

  it.each([
    { feed_type: "rss" },
    { entity_type: "club" },
    { state: "Tennessee" },
    { checked_at: "Sept 25" },
    { feed_url: "javascript:alert(1)" },
    { website: "example.org" },
  ])("rejects %j", (change) => {
    expect(RegistryEntry.safeParse({ ...entry, ...change }).success).toBe(false);
  });

  it("allows entities with no website or feed", () => {
    expect(
      RegistryEntry.parse({
        ...entry,
        website: null,
        feed_type: "none_found",
        feed_url: null,
        verified: false,
        meeting_count: 0,
        states_covered: [],
      }),
    ).toMatchObject({ website: null, feed_url: null });
  });
});
```

- [ ] **Step 2: Run and see it fail.** Create the package shell first (`package.json` like `@mymeetingapp/shared`'s with `test` and `typecheck` scripts, zod, and vitest as a devDependency). Run `pnpm --filter @mymeetingapp/feed-kit test`. Expected: FAIL, because `../src/index` is missing.

- [ ] **Step 3: Implement.**
  - `git mv` the web `throttle.ts` and `address.ts` into `packages/feed-kit/src/`.
  - Move `USER_AGENT` from `fetch-feed.ts` into `user-agent.ts`, built from `BRAND` in `@mymeetingapp/shared` (add it as a dependency).
  - Write `registry.ts`:

```ts
import { z } from "zod";

export const FEED_TYPES = [
  "tsml",
  "meeting_guide_json",
  "google_sheet",
  "bmlt",
  "none_found",
  "restricted",
] as const;
export const REGISTRY_ENTITY_TYPES = ["area", "district", "intergroup", "central_office"] as const;

const WebUrl = z.url({ protocol: /^https?$/ });

// One line of tools/feed-discovery/registry.yaml (spec §4). Keys stay snake_case to match the spec's YAML.
export const RegistryEntry = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  entity_type: z.enum(REGISTRY_ENTITY_TYPES),
  state: z.string().regex(/^[A-Z]{2}$/),
  website: WebUrl.nullable(),
  feed_type: z.enum(FEED_TYPES),
  feed_url: WebUrl.nullable(),
  verified: z.boolean(),
  meeting_count: z.number().int().min(0),
  states_covered: z.array(z.string().regex(/^[A-Z]{2}$/)),
  checked_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string(),
  opted_out: z.boolean().optional(),
});
export type RegistryEntry = z.infer<typeof RegistryEntry>;
```

- `index.ts` re-exports all four modules.
- Rewire the web imports to `@mymeetingapp/feed-kit` (run `pnpm --filter web add "@mymeetingapp/feed-kit@workspace:*"`).
- Delete the moved web files and update `docs/standards.md` wherever it names their old paths.
- `RegistryEntry` has no production consumer until Tasks 7 and 9. If `knip` (default mode) flags it, keep it, since its tests use it, and confirm `knip:production` passes after Task 9.
- [ ] **Step 4: Run** `pnpm check`. Expected: PASS, with the web suite still green on the moved imports.
- [ ] **Step 5: Commit** with the message `refactor(feeds): share the throttle, user agent, address key and registry schema via packages/feed-kit`.

---

### Task 3: The polite crawler

**Files:**

- Create: `tools/feed-discovery/{package.json,tsconfig.json,vitest.config.ts}` and `tools/feed-discovery/src/crawler.ts`
- Modify: `pnpm-workspace.yaml` (add `"tools/*"`), `knip.json` (add a `tools/*` workspace with `src/**/*.ts!` and `test/**/*.ts`)
- Test: `tools/feed-discovery/test/crawler.test.ts`

**Interfaces:**

- Produces:
  - `type CrawlResult`, which is one of:
    - `{ kind: "response"; status: number; url: string; contentType: string; body: string }`
    - `{ kind: "blocked_by_robots"; url: string }`
    - `{ kind: "error"; message: string }`
  - `createCrawler(): { get(url: string): Promise<CrawlResult> }`.

  The crawler caches robots.txt once per origin, and a missing or unreadable robots.txt means everything is allowed. It checks robots and applies the throttle before every hop, including each redirect, and follows at most 5 redirects manually. Each request has a 30 s timeout and a 50 MB cap, which is enforced by `content-length` and while streaming, and it never retries.

- [ ] **Step 1: Package shell.**
  - Name: `feed-discovery`, private, `type: module`.
  - Scripts: `discover` (`tsx src/main.ts`, added in Task 8), `test` (`vitest run`), `typecheck`.
  - Dependencies: `@mymeetingapp/feed-kit`, `robots-parser`, `node-html-parser`, `yaml`, `zod`.
  - devDependencies: `@mymeetingapp/test-server`, `tsx`, `vitest`, `@types/node@24`.
  - `tsconfig.json`: extend the base with `types: ["node"]`.
  - `vitest.config.ts`: node environment and `testTimeout: 30_000`, because the throttle makes tests take seconds.

- [ ] **Step 2: Failing test.** Create `tools/feed-discovery/test/crawler.test.ts`:

```ts
import { startServer } from "@mymeetingapp/test-server";
import { USER_AGENT } from "@mymeetingapp/feed-kit";
import { afterEach, describe, expect, it } from "vitest";

import { createCrawler } from "../src/crawler";

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
async function serve(
  routes: Record<string, { status: number; body?: string; headers?: Record<string, string> }>,
) {
  const server = await startServer((path) => routes[path] ?? { status: 404, body: "not found" });
  servers.push(server);
  return server;
}

describe("createCrawler", () => {
  it("fetches an allowed page with the project User-Agent", async () => {
    const server = await serve({
      "/robots.txt": { status: 404 },
      "/page": { status: 200, body: "hello", headers: { "Content-Type": "text/html" } },
    });
    const result = await createCrawler().get(`${server.baseUrl}/page`);
    expect(result).toEqual({
      kind: "response",
      status: 200,
      url: `${server.baseUrl}/page`,
      contentType: "text/html",
      body: "hello",
    });
    expect(server.requests.find((r) => r.path === "/page")?.headers["user-agent"]).toBe(USER_AGENT);
  });

  it("never requests a path robots.txt disallows", async () => {
    const server = await serve({
      "/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /wp-json/" },
      "/wp-json/tsml/meetings": { status: 200, body: "[]" },
    });
    const result = await createCrawler().get(`${server.baseUrl}/wp-json/tsml/meetings`);
    expect(result).toEqual({ kind: "blocked_by_robots", url: `${server.baseUrl}/wp-json/tsml/meetings` });
    expect(server.requests.map((r) => r.path)).toEqual(["/robots.txt"]);
  });

  it("checks robots.txt again for every redirect hop", async () => {
    const server = await serve({
      "/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /private" },
      "/start": { status: 301, headers: { Location: "/private/feed" } },
      "/private/feed": { status: 200, body: "[]" },
    });
    const result = await createCrawler().get(`${server.baseUrl}/start`);
    expect(result).toEqual({ kind: "blocked_by_robots", url: `${server.baseUrl}/private/feed` });
    expect(server.requests.map((r) => r.path)).not.toContain("/private/feed");
  });

  it("follows allowed redirects and reports the final URL", async () => {
    const server = await serve({
      "/robots.txt": { status: 404 },
      "/old": { status: 301, headers: { Location: "/new" } },
      "/new": { status: 200, body: "ok" },
    });
    expect(await createCrawler().get(`${server.baseUrl}/old`)).toMatchObject({
      kind: "response",
      url: `${server.baseUrl}/new`,
      body: "ok",
    });
  });

  it("stops after five redirects", async () => {
    const server = await serve({
      "/robots.txt": { status: 404 },
      "/loop": { status: 302, headers: { Location: "/loop" } },
    });
    expect(await createCrawler().get(`${server.baseUrl}/loop`)).toEqual({
      kind: "error",
      message: "too many redirects",
    });
  });

  it("refuses a body declared larger than 50 MB without downloading it", async () => {
    const server = await serve({
      "/robots.txt": { status: 404 },
      "/huge": { status: 200, body: "[]", headers: { "Content-Length": String(60 * 1024 * 1024) } },
    });
    expect(await createCrawler().get(`${server.baseUrl}/huge`)).toEqual({
      kind: "error",
      message: "too large",
    });
  });

  it("fetches robots.txt only once per origin", async () => {
    const server = await serve({
      "/robots.txt": { status: 404 },
      "/a": { status: 200, body: "a" },
      "/b": { status: 200, body: "b" },
    });
    const crawler = createCrawler();
    await crawler.get(`${server.baseUrl}/a`);
    await crawler.get(`${server.baseUrl}/b`);
    expect(server.requests.filter((r) => r.path === "/robots.txt")).toHaveLength(1);
  });
});
```

(The oversized-body test declares a `Content-Length` it doesn't send. If Node's HTTP server refuses the mismatch, have the test server respond with `Transfer-Encoding: chunked` and stream 51 MB of `[`. Keep the assertion, and check that memory use doesn't spike: the crawler must stop reading once it passes 50 MB.)

- [ ] **Step 3: Run** `pnpm --filter feed-discovery test`. Expected: FAIL, because the module is missing.

- [ ] **Step 4: Implement** `tools/feed-discovery/src/crawler.ts`:

```ts
import { createHostThrottle, USER_AGENT } from "@mymeetingapp/feed-kit";
import robotsParser from "robots-parser";

const TIMEOUT_MS = 30_000;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export type CrawlResult =
  | { kind: "response"; status: number; url: string; contentType: string; body: string }
  | { kind: "blocked_by_robots"; url: string }
  | { kind: "error"; message: string };

type Robots = ReturnType<typeof robotsParser>;

async function readCapped(response: Response): Promise<string | null> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
  if (response.body === null) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// Spec §4 politeness: robots.txt for every hop, one request per second per host, an honest
// User-Agent, a timeout, and no retries.
export function createCrawler() {
  const throttle = createHostThrottle();
  const robotsByOrigin = new Map<string, Promise<Robots>>();

  async function request(url: URL): Promise<Response | { error: string }> {
    await throttle.wait(url.host);
    try {
      return await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return {
        error: error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not connect",
      };
    }
  }

  function robotsFor(url: URL): Promise<Robots> {
    const robotsUrl = new URL("/robots.txt", url.origin);
    let robots = robotsByOrigin.get(url.origin);
    if (robots === undefined) {
      robots = (async () => {
        const response = await request(robotsUrl);
        const text = response instanceof Response && response.ok ? ((await readCapped(response)) ?? "") : "";
        return robotsParser(robotsUrl.toString(), text);
      })();
      robotsByOrigin.set(url.origin, robots);
    }
    return robots;
  }

  return {
    async get(startUrl: string): Promise<CrawlResult> {
      let url = new URL(startUrl);
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        if ((await robotsFor(url)).isDisallowed(url.toString(), USER_AGENT) === true) {
          return { kind: "blocked_by_robots", url: url.toString() };
        }
        const response = await request(url);
        if (!(response instanceof Response)) return { kind: "error", message: response.error };
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location !== null) {
          url = new URL(location, url);
          continue;
        }
        const body = await readCapped(response);
        if (body === null) return { kind: "error", message: "too large" };
        return {
          kind: "response",
          status: response.status,
          url: url.toString(),
          contentType: response.headers.get("content-type") ?? "",
          body,
        };
      }
      return { kind: "error", message: "too many redirects" };
    },
  };
}

export type Crawler = ReturnType<typeof createCrawler>;
```

(If `robots-parser`'s default import doesn't typecheck under `esModuleInterop`, use the form its `index.d.ts` documents. If `for await` over `response.body` needs a DOM iterable type, add `"DOM.AsyncIterable"` to this package's `lib`.)

- [ ] **Step 5: Run** the tests, then `pnpm check`. Expected: PASS. Commit with the message `feat(discovery): add the polite crawler (robots per hop, throttle, timeout, size cap)`.

---

### Task 4: Parsing the aa.org directory

**Files:**

- Create: `tools/feed-discovery/src/states.ts`, `tools/feed-discovery/src/directory.ts`
- Test: `tools/feed-discovery/test/directory.test.ts`

**Interfaces:**

- Produces:
  - `US_STATES: readonly { code: string; name: string }[]`: the 50 states plus DC, PR, GU, VI, AS and MP, which are the aa.org `state=` values excluding military codes.
  - `interface DirectoryEntity { id: string; name: string; entityType: RegistryEntry["entity_type"]; state: string; website: string | null; notes: string }`.
  - `parseDirectoryPage(html: string, stateCode: string): DirectoryEntity[]`, which returns the page's `.area-loc-item` entities and its related-area footer entries (as `area`).
  - `entityId(name, state)` builds a slug of the name followed by the lowercase state code, e.g. `aa-vermont-district-11-vt`.
  - Websites are normalized to `http(s)://host/path` with no trailing slash, and a missing website becomes `null` with the note "no website listed".

- [ ] **Step 1: Check the real markup first.** The research (2026-09-27) saved copies of aa.org pages in the session scratchpad. Open one locally and confirm the markup:
  - items: `div.area-loc-item > h3`, then `address`, then `p > a[href]`;
  - the area footer: `div.related-areas h4` plus the link that follows it.

  Build the fixture below to match what you see. **Don't commit real aa.org HTML.** Use a synthetic fixture with the same structure.

- [ ] **Step 2: Failing test.** Create `tools/feed-discovery/test/directory.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseDirectoryPage } from "../src/directory";

const page = `
<div class="area-loc-item"><h3>AA Vermont District 11</h3><address> Chittenden County , Vermont </address>
<p><a href="http://www.aavt.org" target="_blank" rel="nofollow">http://www.aavt.org</a><br><span>Answering Service:</span>(802) 802-2288</p></div>
<div class="area-loc-item"><h3>Burlington Area Intergroup</h3><address> Burlington , Vermont </address>
<p><a href="https://burlingtonaa.org/" rel="nofollow">https://burlingtonaa.org/</a></p></div>
<div class="area-loc-item"><h3>Oficina Central Hispana</h3><address> Rutland , Vermont </address><p><span>Phone:</span>(802) 555-0100</p></div>
<div class="area-loc-item"><h3>Northern Vermont Answering Service</h3><address> Barre , Vermont </address>
<p><a href="https://nvtaa.org" rel="nofollow">https://nvtaa.org</a></p></div>
<div class="related-areas"><h4>Area 070 - Vermont</h4><div class="field--name-field-url"><a href="http://www.aavt.org">http://www.aavt.org</a></div></div>`;

describe("parseDirectoryPage", () => {
  it("parses entities, infers their type from the name, and adds the area footer", () => {
    expect(parseDirectoryPage(page, "VT")).toEqual([
      {
        id: "aa-vermont-district-11-vt",
        name: "AA Vermont District 11",
        entityType: "district",
        state: "VT",
        website: "http://www.aavt.org",
        notes: "",
      },
      {
        id: "burlington-area-intergroup-vt",
        name: "Burlington Area Intergroup",
        entityType: "intergroup",
        state: "VT",
        website: "https://burlingtonaa.org",
        notes: "",
      },
      {
        id: "oficina-central-hispana-vt",
        name: "Oficina Central Hispana",
        entityType: "central_office",
        state: "VT",
        website: null,
        notes: "no website listed",
      },
      {
        id: "northern-vermont-answering-service-vt",
        name: "Northern Vermont Answering Service",
        entityType: "intergroup",
        state: "VT",
        website: "https://nvtaa.org",
        notes: "type inferred",
      },
      {
        id: "area-070-vermont-vt",
        name: "Area 070 - Vermont",
        entityType: "area",
        state: "VT",
        website: "http://www.aavt.org",
        notes: "",
      },
    ]);
  });

  it("ignores links that aren't http(s)", () => {
    const html = `<div class="area-loc-item"><h3>X Intergroup</h3><address>A, Vermont</address><p><a href="mailto:x@y.org">x</a></p></div>`;
    expect(parseDirectoryPage(html, "VT")[0]?.website).toBeNull();
  });

  it("returns nothing for a page with no listings", () => {
    expect(parseDirectoryPage("<html><body>none</body></html>", "VT")).toEqual([]);
  });
});
```

- [ ] **Step 3: Run** `pnpm --filter feed-discovery exec vitest run directory`. Expected: FAIL, because the module is missing.

- [ ] **Step 4: Implement.**

`states.ts`: the 56 `{ code, name }` pairs (AL Alabama … WY Wyoming, DC District of Columbia, PR Puerto Rico, GU Guam, VI U.S. Virgin Islands, AS American Samoa, MP Northern Mariana Islands).

`directory.ts`:

```ts
import type { RegistryEntry } from "@mymeetingapp/feed-kit";
import { parse } from "node-html-parser";

export interface DirectoryEntity {
  id: string;
  name: string;
  entityType: RegistryEntry["entity_type"];
  state: string;
  website: string | null;
  notes: string;
}

const TYPE_RULES: { pattern: RegExp; type: RegistryEntry["entity_type"] }[] = [
  { pattern: /\bintergrou?po?\b|\bintergroup\b/i, type: "intergroup" },
  { pattern: /central (office|service)|oficina central|service office/i, type: "central_office" },
  { pattern: /\bdistri(ct|to)\b/i, type: "district" },
];

export function entityId(name: string, state: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug}-${state.toLowerCase()}`;
}

function website(href: string | undefined): string | null {
  if (href === undefined || !/^https?:\/\//i.test(href.trim())) return null;
  try {
    const url = new URL(href.trim());
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

function entity(
  name: string,
  state: string,
  href: string | undefined,
  forcedType?: RegistryEntry["entity_type"],
): DirectoryEntity {
  const rule = TYPE_RULES.find(({ pattern }) => pattern.test(name));
  const site = website(href);
  const notes = [
    site === null ? "no website listed" : "",
    forcedType === undefined && rule === undefined ? "type inferred" : "",
  ]
    .filter((note) => note !== "")
    .join("; ");
  return {
    id: entityId(name, state),
    name,
    entityType: forcedType ?? rule?.type ?? "intergroup",
    state,
    website: site,
    notes,
  };
}

// One aa.org "Find A.A. Near You" state page: listed offices plus the General Service areas in its footer.
export function parseDirectoryPage(html: string, stateCode: string): DirectoryEntity[] {
  const root = parse(html);
  const offices = root
    .querySelectorAll(".area-loc-item")
    .map((item) =>
      entity(
        item.querySelector("h3")?.text.trim() ?? "",
        stateCode,
        item.querySelector("p a")?.getAttribute("href"),
      ),
    );
  const areas = root
    .querySelectorAll(".related-areas")
    .map((block) =>
      entity(
        block.querySelector("h4")?.text.trim() ?? "",
        stateCode,
        block.querySelector("a")?.getAttribute("href"),
        "area",
      ),
    );
  return [...offices, ...areas].filter((found) => found.name !== "");
}
```

If the real footer holds several areas per `.related-areas` block, iterate over its `h4` elements, pairing each with the next link, and add a fixture case for it.

- [ ] **Step 5: Run** the tests, then `pnpm check`. Expected: PASS. Commit with the message `feat(discovery): parse aa.org directory pages into entities`.

---

### Task 5: Detecting feeds

**Files:**

- Create: `tools/feed-discovery/src/detect.ts`
- Test: `tools/feed-discovery/test/detect.test.ts`

**Interfaces:**

- Consumes: `Crawler` (Task 3).
- Produces: `detectFeed(website: string, crawler: Crawler): Promise<Detection>`, where `Detection` is one of:
  - `{ feedType: "tsml" | "meeting_guide_json" | "google_sheet"; feedUrl: string; body: unknown; notes: string }`
  - `{ feedType: "restricted"; feedUrl: string | null; notes: string }`
  - `{ feedType: "none_found"; notes: string }`

**Order (spec §4)** — stop at the first definite answer:

| Step | Request or source                                                                                    | Outcome                                                                                                                                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `GET {site}/wp-json/tsml/meetings`                                                                   | A JSON array is `tsml`. A 403 whose JSON body has `code` = `feed_restricted` is `restricted`.                                                                                                                                                                                      |
| 2    | `GET {site}/wp-admin/admin-ajax.php?action=meetings`                                                 | A JSON array is `tsml`. A 401 is `restricted`.                                                                                                                                                                                                                                     |
| 3    | `GET {site}` (homepage), `<link rel="alternate" type="application/json" title="Meetings Feed" href>` | Fetch the linked feed. A JSON array is `meeting_guide_json`, or `google_sheet` when the host is `sheets.code4recovery.org`.                                                                                                                                                        |
| 4    | The homepage's `#tsml-ui[data-src]` (comma-separated sources)                                        | A source containing `key=` is `restricted` (never used). A `docs.google.com/spreadsheets/d/{id}` source is fetched as `https://sheets.code4recovery.org/storage/{id}.json` and becomes `google_sheet`. Any other source is fetched, and a JSON array becomes `meeting_guide_json`. |
| 5    | The homepage's `<meta name="12_step_meeting_list">`, with no open feed found above                   | `restricted`, noted "TSML installed; sharing restricted".                                                                                                                                                                                                                          |
| 6    | A homepage that mentions `client_interface`                                                          | `none_found`, noted "BMLT suspected".                                                                                                                                                                                                                                              |
| 7    | Anything else                                                                                        | `none_found`. A `blocked_by_robots` result on every probe is noted "blocked by robots.txt".                                                                                                                                                                                        |

- [ ] **Step 1: Failing test.** Create `tools/feed-discovery/test/detect.test.ts`. It uses one local server per scenario, whose route table plays a WordPress site. Keep each scenario's routes minimal:

```ts
import { startServer } from "@mymeetingapp/test-server";
import { afterEach, describe, expect, it } from "vitest";

import { createCrawler } from "../src/crawler";
import { detectFeed } from "../src/detect";

type Routes = Record<string, { status: number; body?: string; headers?: Record<string, string> }>;
const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
const json = { "Content-Type": "application/json" };
const meetings = JSON.stringify([{ slug: "a", name: "A", day: 1, time: "19:00" }]);

async function site(routes: Routes) {
  const server = await startServer(
    (path) => routes[path] ?? { status: 404, body: '{"code":"rest_no_route"}', headers: json },
  );
  servers.push(server);
  return server;
}

describe("detectFeed", () => {
  it("finds an open TSML REST feed first", async () => {
    const s = await site({ "/wp-json/tsml/meetings": { status: 200, body: meetings, headers: json } });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({
      feedType: "tsml",
      feedUrl: `${s.baseUrl}/wp-json/tsml/meetings`,
    });
  });

  it("records a restricted TSML REST feed and stops probing", async () => {
    const s = await site({
      "/wp-json/tsml/meetings": {
        status: 403,
        body: '{"code":"feed_restricted","message":"This meeting list is restricted."}',
        headers: json,
      },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toEqual({
      feedType: "restricted",
      feedUrl: `${s.baseUrl}/wp-json/tsml/meetings`,
      notes: "TSML feed restricted; contact the intergroup",
    });
    expect(s.requests.map((r) => r.path)).not.toContain("/wp-admin/admin-ajax.php?action=meetings");
  });

  it("falls back to the legacy AJAX feed", async () => {
    const s = await site({
      "/wp-admin/admin-ajax.php?action=meetings": { status: 200, body: meetings, headers: json },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({
      feedType: "tsml",
      feedUrl: `${s.baseUrl}/wp-admin/admin-ajax.php?action=meetings`,
    });
  });

  it("records a restricted AJAX feed", async () => {
    const s = await site({
      "/wp-admin/admin-ajax.php?action=meetings": {
        status: 401,
        body: '{"error":"HTTP/1.1 401 Unauthorized"}',
        headers: json,
      },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({ feedType: "restricted" });
  });

  it("follows a Meetings Feed link on the homepage", async () => {
    const s = await site({
      "/": {
        status: 200,
        body: '<link rel="alternate" type="application/json" title="Meetings Feed" href="/feed.json">',
      },
      "/feed.json": { status: 200, body: meetings, headers: json },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({
      feedType: "meeting_guide_json",
      feedUrl: `${s.baseUrl}/feed.json`,
    });
  });

  it("treats a TSML UI source that carries a sharing key as restricted and never fetches it", async () => {
    const s = await site({
      "/": {
        status: 200,
        body: '<div id="tsml-ui" data-src="/wp-admin/admin-ajax.php?action=meetings&key=abc"></div>',
      },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({ feedType: "restricted" });
    expect(s.requests.map((r) => r.path)).not.toContain("/wp-admin/admin-ajax.php?action=meetings&key=abc");
  });

  it("reports TSML installed with sharing restricted", async () => {
    const s = await site({
      "/": { status: 200, body: '<meta name="12_step_meeting_list" content="3.19.19">' },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toEqual({
      feedType: "restricted",
      feedUrl: null,
      notes: "TSML installed; sharing restricted",
    });
  });

  it("notes a suspected BMLT site for the manual backlog", async () => {
    const s = await site({
      "/": {
        status: 200,
        body: '<script src="https://bmlt.example/main_server/client_interface/jsonp/"></script>',
      },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toEqual({
      feedType: "none_found",
      notes: "BMLT suspected",
    });
  });

  it("finds nothing on a plain site", async () => {
    const s = await site({ "/": { status: 200, body: "<p>Call us</p>" } });
    expect(await detectFeed(s.baseUrl, createCrawler())).toEqual({ feedType: "none_found", notes: "" });
  });

  it("notes a site that blocks all probes in robots.txt", async () => {
    const s = await site({ "/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /" } });
    expect(await detectFeed(s.baseUrl, createCrawler())).toEqual({
      feedType: "none_found",
      notes: "blocked by robots.txt",
    });
    expect(s.requests.map((r) => r.path)).toEqual(["/robots.txt"]);
  });
});
```

(The Google Sheet rewrite to `sheets.code4recovery.org` points at a real third-party host, so it isn't exercised here. Test the pure rewrite function `sheetStorageUrl(url)` directly, with literal input and output.)

- [ ] **Step 2: Run** `pnpm --filter feed-discovery exec vitest run detect`. Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement** `detect.ts`. It needs:
  - a helper `jsonArray(result)` that returns the parsed array only for a 2xx response whose body parses to an array;
  - a helper `jsonCode(result)` that reads `code` from a JSON error body;
  - an exported `sheetStorageUrl(url): string | null` that turns `docs.google.com/spreadsheets/d/{id}/…` into `https://sheets.code4recovery.org/storage/{id}.json`;
  - `detectFeed`, which walks the order table above using `crawler.get` and returns as soon as it has a definite answer.

  Parse the homepage with `node-html-parser`. Resolve relative `href`/`data-src` values against the final homepage URL. Keep every branch in the table, and nothing more.

- [ ] **Step 4: Run** the tests, then `pnpm check`. Expected: PASS. Commit with the message `feat(discovery): detect feeds in the spec's order and record restricted ones`.

---

### Task 6: Verifying feeds

**Files:**

- Create: `tools/feed-discovery/src/verify.ts`
- Test: `tools/feed-discovery/test/verify.test.ts`

**Interfaces:**

- Consumes: `addressKey` (feed-kit).
- Produces: `verifyFeed(body: unknown): { verified: boolean; meetingCount: number; statesCovered: string[]; meetingKeys: Set<string> }`.
  - `verified` is true when the body is a non-empty array and at least one item has `slug`, `name`, `day` and `time`.
  - `meetingCount` is the array's length.
  - `statesCovered` holds the sorted, unique US codes from each item's `state` (2 letters), or else from `formatted_address` via `/,\s*([A-Z]{2})\s+\d{5}/`.
  - `meetingKeys` holds `${day}|${time}|${addressKey(formatted_address)}` for items that have all three. They're used for overlap detection and never written to disk.

- [ ] **Step 1: Failing test.** Create `tools/feed-discovery/test/verify.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { verifyFeed } from "../src/verify";

const meeting = {
  slug: "a",
  name: "A",
  day: 1,
  time: "19:00",
  formatted_address: "1 Main St, Nashville, TN 37203, USA",
};

describe("verifyFeed", () => {
  it("verifies a meeting array and summarizes it", () => {
    const result = verifyFeed([
      meeting,
      { ...meeting, slug: "b", state: "KY", formatted_address: undefined },
      { slug: "c", name: "By appointment" },
    ]);
    expect(result).toMatchObject({ verified: true, meetingCount: 3, statesCovered: ["KY", "TN"] });
    expect([...result.meetingKeys]).toEqual(["1|19:00|1 main st nashville tn 37203"]);
  });

  it.each([[], {}, null, "[]", [{ slug: "a", name: "A" }], [{ title: "x" }]])(
    "does not verify %j",
    (body) => {
      expect(verifyFeed(body).verified).toBe(false);
    },
  );

  it("ignores non-US state codes and malformed addresses", () => {
    expect(verifyFeed([{ ...meeting, state: "ON", formatted_address: "Toronto" }]).statesCovered).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter feed-discovery exec vitest run verify`. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement** `verify.ts`, using `US_STATES` codes for the US check and `addressKey` from feed-kit. Casts are allowed only after runtime checks.
- [ ] **Step 4: Run** the tests, then `pnpm check`. Expected: PASS. Commit with the message `feat(discovery): verify feeds and record counts, states and meeting keys`.

---

### Task 7: The registry file and coverage report

**Files:**

- Create: `tools/feed-discovery/src/registry-file.ts`, `tools/feed-discovery/src/report.ts`
- Test: `tools/feed-discovery/test/registry-file.test.ts`, `tools/feed-discovery/test/report.test.ts`

**Interfaces:**

- Produces:
  - `readRegistry(path): Promise<RegistryEntry[]>`: an empty list when the file is missing, and each entry validated with `RegistryEntry`.
  - `writeRegistry(path, entries)`: YAML sorted by `state`, then `id`, with keys in the spec's order.
  - `buildRegistry(found: { entity: DirectoryEntity; detection: Detection; verification: ReturnType<typeof verifyFeed> | null }[], previous: RegistryEntry[], checkedAt: string): RegistryEntry[]`: carries `opted_out` over from `previous` by `id`.
  - `computeOverlaps(keysByFeed: Map<string, Set<string>>): { a: string; b: string; shared: number }[]`: pairs sharing at least one meeting key, sorted by shared count, highest first.
  - `computeChanges(previous, current)`, which returns three lists:
    - `stoppedResponding`: ids that were verified before and aren't now;
    - `newEntities`: ids that weren't there before;
    - `countDrops`: `{ id, from, to }` for drops over 30%.
  - `renderCoverage(entries, overlaps, changes): string`: the markdown for `coverage.md`.

- [ ] **Step 1: Failing tests.** Create `registry-file.test.ts` with three tests:
  1. A write/read round-trip in a temp dir keeps entries and order.
  2. A missing file reads as `[]`.
  3. An invalid entry in the file throws, naming the entry's id.

  Create `report.test.ts` with these tests:
  - **Registry:** `buildRegistry` produces the spec example entry from a found TSML detection with verification (literal expected object, `checked_at` passed in), and turns a restricted detection into `verified: false, meeting_count: 0, notes: "…contact the intergroup"`.
  - **Opt-outs (Review Focus 3):** `buildRegistry` keeps `opted_out: true` from `previous`.
  - **Overlaps:** `computeOverlaps` returns `[{ a: "x", b: "y", shared: 2 }]` for two feeds sharing two keys, and nothing for disjoint feeds.
  - **Changes:** `computeChanges` flags a verified feed that became `none_found`, a new id, and a drop from 100 to 60 meetings, but not 100 to 71.
  - **Report:** `renderCoverage` for a two-state fixture matches this literal markdown exactly:

```markdown
# Feed coverage

Checked 2026-09-27. 3 entities, 1 verified feed, 612 meetings.

| State | Entities | Verified feeds | Meetings | Restricted | No feed |
| ----- | -------- | -------------- | -------- | ---------- | ------- |
| TN    | 2        | 1              | 612      | 1          | 0       |
| VT    | 1        | 0              | 0        | 0          | 1       |

## Restricted feeds (contact the intergroup)

- Other Intergroup (TN) — https://other.example.org

## No feed found (manual backlog)

- Vermont Office (VT) — no website listed

## Overlapping feeds

None.

## Changes since the last run

None.
```

- [ ] **Step 2: Run** the tests. Expected: FAIL, because the modules are missing.
- [ ] **Step 3: Implement** both modules.
  - `registry-file.ts` uses `yaml`'s `parse`/`stringify`, and validates with `RegistryEntry` from feed-kit.
  - `report.ts` is pure functions. Its counts come from `entries`, and a restricted entry's listing shows `website`.
- [ ] **Step 4: Run** the tests, then `pnpm check`. Expected: PASS. Commit with the message `feat(discovery): write registry.yaml and coverage.md with overlaps and changes`.

---

### Task 8: The discovery command

**Files:**

- Create: `tools/feed-discovery/src/main.ts`
- Modify: `tools/feed-discovery/package.json` (the `discover` script) and `eslint.config.js` (allow `console.log` in `tools/*/src/main.ts`, the command's output)
- Test: `tools/feed-discovery/test/main.test.ts`

**Interfaces:**

- Produces: `pnpm --filter feed-discovery discover [--state VT] [--directory-url URL] [--out-dir DIR]`.
  - The default `--directory-url` is `https://www.aa.org/find-aa/north-america`.
  - `--state` is repeatable or comma-separated, and defaults to every code in `US_STATES`.
  - `--out-dir` defaults to the tool directory.
  - `run(options): Promise<{ entities: number; verified: number }>` is exported for the test.

**Flow:**

1. Create one crawler.
2. For each state, `get(`${directoryUrl}?state=${code}`)` and `parseDirectoryPage`. De-duplicate by `id`; areas repeat across states.
3. Read the previous `registry.yaml`.
4. For entities with a website, `detectFeed`, then `verifyFeed` on the returned body. Run up to 8 entities at once; the per-host throttle keeps each site at 1 request per second.
5. `buildRegistry`, `computeOverlaps`, `computeChanges`, `writeRegistry`, and write `coverage.md`.
6. Log only counts and progress, e.g. `VT: 5 entities` and `42/700 checked`. Never log URLs of restricted feeds or any body.

- [ ] **Step 1: Failing test.** Create `tools/feed-discovery/test/main.test.ts`. It starts two local servers:
  1. a "directory" serving `?state=VT` with a fixture page listing two entities, whose websites point at the second server's origin plus distinct paths (e.g. `/open` and `/closed`);
  2. a "site" server where `/open/wp-json/tsml/meetings` is an open feed and `/closed/wp-json/tsml/meetings` is `feed_restricted`.

  Run `run({ states: ["VT"], directoryUrl, outDir: tmp })` and assert:
  - it returns `{ entities: 2, verified: 1 }`;
  - `registry.yaml` in `tmp` holds one `tsml` entry and one `restricted` entry;
  - `coverage.md` lists the restricted one under "contact the intergroup".

- [ ] **Step 2: Run** `pnpm --filter feed-discovery exec vitest run main`. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement** `main.ts`. `run()` is the logic. The bottom of the file parses `process.argv` with `node:util` `parseArgs` and calls `run` only when the file is executed directly (compare `import.meta.url` to `process.argv[1]`). Add `"discover": "tsx src/main.ts"` to the package scripts.
- [ ] **Step 4: Run** the tests, then `pnpm check`, then `pnpm knip:production`. Expected: PASS. Commit with the message `feat(discovery): add the discover command`.

---

### Task 9: Seeding the `feeds` table from the registry

**Files:**

- Create: `apps/web/src/db/seed-feeds.ts`, `apps/web/scripts/seed-feeds.ts`
- Modify: `apps/web/package.json` (the `db:seed-feeds` script, and add `yaml` and `@mymeetingapp/feed-kit` dependencies if they're missing)
- Test: `apps/web/test/seed-feeds.test.ts`

**Interfaces:**

- Consumes: `upsertFeed` (Phase 2), `RegistryEntry` (feed-kit), and the `feeds` table.
- Produces:
  - `seedFeedsFromRegistry(entries: RegistryEntry[]): Promise<{ upserted: number; optedOut: number; skipped: number }>`. It upserts every entry that is `verified`, has a `feed_url`, and has `feed_type` of `tsml`, `meeting_guide_json` or `google_sheet`, using `slug: id`, `name`, `entityType: entity_type`, `state` and `url: feed_url`. Priority comes from `upsertFeed`'s entity-type default. For entries with `opted_out: true`, it sets `feeds.opted_out = true`. Everything else is skipped.
  - The command `pnpm --filter web db:seed-feeds <path-to-registry.yaml>`.

- [ ] **Step 1: Failing test.** `apps/web/test/seed-feeds.test.ts` feeds four entries to `seedFeedsFromRegistry`:
  1. a verified `tsml` entry;
  2. a `restricted` entry;
  3. a `none_found` entry;
  4. a verified entry with `opted_out: true`.

  Assert the result `{ upserted: 2, optedOut: 1, skipped: 2 }`. Assert that the `feeds` rows have the expected slugs, URLs and priorities (intergroup 10, area 20), and that the opted-out feed has `optedOut: true`. Assert that running it twice changes nothing.

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run seed-feeds`. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement** `seed-feeds.ts` and the command script. The script follows the `seed.ts` pattern: `loadLocalEnvFile()`, then dynamic imports, then read YAML, then validate each entry with `RegistryEntry`, then seed, then print the counts.
- [ ] **Step 4: Run** `pnpm check`, then `pnpm knip:production`. Expected: PASS, and `RegistryEntry` now has production consumers. Commit with the message `feat(feeds): seed the feeds table from the discovery registry`.

---

### Task 10: The monthly re-verification workflow

**Files:**

- Create: `.github/workflows/feed-discovery.yml`, `docs/feed-discovery.md`

**What it does:**

- **Triggers:** runs on `schedule: "0 9 1 * *"` (09:00 UTC on the 1st) and on `workflow_dispatch`.
- **Permissions:** `contents: write` and `pull-requests: write`.
- **Steps:**
  1. Check out the repo, set up Node from `.nvmrc`, run `corepack enable`, and run `pnpm install --frozen-lockfile`.
  2. Run `pnpm --filter feed-discovery discover`.
  3. If `git status --porcelain tools/feed-discovery` shows changes, create the branch `registry/$(date +%Y-%m)`, commit the registry and coverage, push, and run `gh pr create`. The PR's title is `Feed registry refresh YYYY-MM`, and its body is the "Changes since the last run" section of `coverage.md`.
- **Timeout:** `timeout-minutes: 180`.

- [ ] **Step 1: Write the workflow.** Lint it with `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -no-color .github/workflows/feed-discovery.yml`. Expected: no output.
- [ ] **Step 2: Write `docs/feed-discovery.md`,** the runbook. It covers:
  - how to run discovery locally, for one state and for everything;
  - how long a full run takes;
  - how to review the PR;
  - how to record an opt-out (`opted_out: true` on the entry);
  - how to seed: `vercel env run -e production -- pnpm --filter web db:seed-feeds ../../tools/feed-discovery/registry.yaml`, with `.env.local` moved aside;
  - the repo setting "Allow GitHub Actions to create pull requests", which the user must turn on.
- [ ] **Step 3: Run** `pnpm check`. Expected: PASS. Commit with the message `ci(discovery): refresh the feed registry monthly via a pull request`.

---

### Task 11: The first run (with the user)

This sends requests to about 700 third-party sites, so **don't start without the user's explicit go-ahead.**

- [ ] **Step 1: Confirm with the user.**
  - They want to run now, or after any ippolicy@aa.org question.
  - They accept the expected duration.
- [ ] **Step 2: Pilot.** Run `pnpm --filter feed-discovery discover --state VT,TN`, then show the user the resulting `coverage.md` and spot-check three entries by hand.
- [ ] **Step 3: Full run.** Run `pnpm --filter feed-discovery discover`, then commit `registry.yaml` and `coverage.md` on a branch and open a PR.
- [ ] **Step 4: Seed production.** After Phase 2 is live, seed production (per the runbook) and trigger one sync. Check `/metrics`-style counts with SQL: the number of synced feeds and the number of meetings.

---

## Done when

- `pnpm check`, `pnpm knip:production` and actionlint pass, and CI is green.
- The tool produces `registry.yaml` and a per-state `coverage.md`. Restricted feeds are recorded and never bypassed, robots.txt is respected on every hop, and requests are throttled per host.
- The verified feeds are seeded into production, and the monthly workflow is enabled.
- Spec §14 criterion: "Feed discovery produces a registry and per-state coverage report, with restricted feeds recorded and skipped."
