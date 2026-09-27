# Phase 2: Meeting Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync meeting feeds into canonical meetings twice a day or better, and serve them through `POST /api/v1/meetings/search`, `GET /api/v1/meetings/online` and `GET /api/v1/meetings/:id`.

**Architecture:**

- **One normalizer** turns any Meeting Guide JSON feed into allowlisted `FeedMeeting` rows. TSML, plain Meeting Guide JSON, Google Sheets (through the Code for Recovery sheets service) and BMLT (through its `client_interface/tsml/` endpoint) all produce that format.
- **Two tables:**
  - `feed_meetings`: raw rows per source.
  - `meetings`: canonical identity (stable UUID), the effective coordinates, the time zone, and a pointer to the highest-priority active source. Display fields are read from that source row through a join, so they are never copied.
  - PostGIS supplies a `location` column generated from latitude and longitude, with a GiST index.
- **Sync run:** a cron route runs it under a Postgres advisory lock with a time budget. It fetches the due feeds politely, applies each one in a transaction (matching new rows to existing canonical meetings), then geocodes missing coordinates through the Census geocoder.

**Tech Stack:** Next.js 16 route handlers, Drizzle ORM 0.45 + `pg`, PostGIS 3.5, zod 4, `@photostructure/tz-lookup`, the US Census Geocoder, and Vercel Cron (Pro).

**Spec:** `SPEC.md` (v2): §2, §3, §7. Roadmap: `docs/superpowers/plans/2026-09-26-roadmap.md`. Standards: `docs/standards.md` (binding).

## Decisions this plan makes (confirm at review)

1. **One parser, not one per feed type.** Research (2026-09-26) found that all four feed types can serve Meeting Guide JSON:
   - TSML: `/wp-json/tsml/meetings`, or `/wp-admin/admin-ajax.php?action=meetings` on older sites.
   - Google Sheets: `https://sheets.code4recovery.org/storage/{sheetId}.json`.
   - BMLT: `{root}/client_interface/tsml/?switcher=GetSearchResults`.

   The spec's "BMLT gets its own mapping" becomes "BMLT is fetched from its Meeting Guide endpoint". Phase 7 records the right URL form per feed.

2. **No tag fields in meeting responses yet.** Phase 3 adds `tags` to `MeetingSummary`. Adding a field is backward-compatible for v1 clients, and shipping an always-empty field now would be dead code.
3. **No Runtime Cache for search yet.** The spec says search "may be cached". A GiST-indexed radius query is fast, so a cache would be unused complexity. Add it only if production timings call for it.
4. **`GET /api/v1/meetings/online` takes a required `?day=0..6`.** Nationwide online meetings for all days could exceed Vercel's 4.5 MB response limit. A per-day response is about a seventh of the size and caches well.
5. **"By appointment" and inactive meetings are skipped.** Rows with no day or time, and rows that are neither in person nor online, can't be searched or tagged.
6. **Official type codes only.** Types are filtered to the official Meeting Guide list. `ONL` and `TC` are dropped because the `attendance` value already encodes them.
7. **A feed that shrinks by more than half is not applied.** If a feed that previously had 20 or more meetings suddenly returns fewer than half as many, the sync records an error and changes nothing. This protects tag history from feed hiccups (spec §3).
8. **Failing feeds are retried at most once an hour** ("no retry storms").
9. **TLS:** connection strings are rewritten to `sslmode=verify-full`, keeping full certificate verification when pg 9 weakens `require`.

## Global Constraints

- Everything in `docs/standards.md`:
  - `pnpm check` passes on every commit, and `pnpm knip:production` passes at the end of the phase.
  - Test-driven: a failing test first.
  - No dead code, and one way per concern.
- Spec §2: coordinates sent to search are rounded to 2 decimals on the phone. The server rejects anything more precise, never stores or logs them, and they appear only in the POST body.
- Spec §2: never log request headers, request bodies or query parameters. `withErrors` already enforces this for database errors.
- Spec §3 field allowlist: store only name, day, time, end time, time zone, types, location name, address, coordinates, location notes, meeting notes, group name, conference URL, phone and notes, attendance option, and source page URL. **Never** store `contact_*`, `email`, `phone`, `venmo`, `square`, `paypal`, `feedback_emails` or `entity_*`.
- Spec §3: `feed_meetings` is unique on `(feed_id, source_slug, day)`, and a meeting listed on several days becomes one row per day.
- Spec §3 matching: same day and start time, plus either the same normalized address or coordinates within 50 m. Online-only meetings match on the same conference URL.
- Spec §3 politeness:
  - At most 1 request per second per host.
  - `If-None-Match` and `If-Modified-Since`.
  - A per-request timeout.
  - A User-Agent with a contact email at mymeetingapp.com.
- Spec §3 sync:
  - A cron every 15 minutes.
  - Feeds are due when their last success is more than 12 h old.
  - Stop starting new feeds after about 240 s.
  - Idempotent, and one failing feed never affects the others.
- Spec §3: archive rather than delete. A canonical meeting is archived when all its sources are archived, and opted-out feeds are not synced.
- Spec §7 errors: `{ error: { code, message } }` with plain-language messages.
- **Deployment needs Vercel Pro:** Hobby rejects a cron more frequent than daily, so upgrade before merging this phase.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019qtuWT6wkew2g1c4qi6eKc
  ```

## Review Focus

1. **A feed hiccup that returns a fraction of its meetings** must not archive the rest. Pinned in Task 11 ("does not apply a feed that shrank by more than half").
2. **Unsafe URLs in a feed** (`javascript:`, `data:`, relative) must never be served as `conferenceUrl` or `sourceUrl`. Pinned in Task 5.
3. **Unrounded coordinates sent to search** must be rejected with `invalid_request`, never silently accepted. Pinned in Task 13.
4. **Two different meetings at the same address and time in one feed** (two rooms) must stay separate, while a slug rename keeps the same canonical meeting. Pinned in Task 9.
5. **A restricted feed (401/403)** is recorded as restricted and not retried within the hour. Pinned in Task 11.

---

## File structure

```
packages/shared/src/
  brand.ts                BRAND (appName, domain, contactEmail) — feed User-Agent
  meetings.ts             MEETING_TYPE_CODES, MeetingSummary, search/online/detail contracts
  errors.ts               + invalid_request, meeting_not_found, unauthorized
apps/web/
  drizzle/0001_enable-postgis.sql, 0002_*.sql (generated), 0003_meeting-location.sql
  scripts/add-feed.ts     CLI: register or update a feed
  src/db/connection-url.ts        withVerifiedTls()
  src/db/client.ts                + Executor type, TLS
  src/db/schema/feeds.ts          feeds
  src/db/schema/meetings.ts       meetings, feed_meetings, address_geocodes, meetingLocation
  src/db/upsert-feed.ts           upsertFeed()
  src/lib/api/respond.ts          + ApiError, statuses, cache policies
  src/lib/api/request.ts          parseInput(), readJsonBody()
  src/lib/api/cron-auth.ts        assertCronRequest()
  src/server/feeds/address.ts     addressKey()
  src/server/feeds/normalize.ts   normalizeFeed(), FeedMeeting, FeedFormatError
  src/server/feeds/throttle.ts    createHostThrottle()
  src/server/feeds/fetch-feed.ts  fetchFeed()
  src/server/meetings/recompute.ts   recomputeMeetings()
  src/server/meetings/apply-feed.ts  applyFeedSnapshot(), findMatchingMeeting()
  src/server/meetings/geocode.ts     parseCensusResponse(), geocodePendingAddresses()
  src/server/meetings/summary.ts     summaryColumns, primarySource join
  src/server/meetings/search.ts, online.ts, detail.ts
  src/server/sync/run-sync.ts     runSync(), SyncSummary
  src/app/api/cron/sync-feeds/route.ts
  src/app/api/v1/meetings/search/route.ts
  src/app/api/v1/meetings/online/route.ts
  src/app/api/v1/meetings/[id]/route.ts
  test/http-server.ts     startServer() — real local HTTP server for feed/geocoder tests
  test/feed-fixtures.ts   feedMeeting(), seedFeed() — builds real rows through the pipeline
```

---

### Task 1: Expected errors and input parsing

**Files:**

- Modify: `packages/shared/src/errors.ts`, `apps/web/src/lib/api/respond.ts`, `docs/standards.md`
- Create: `apps/web/src/lib/api/request.ts`
- Test: `apps/web/test/respond.test.ts`, `apps/web/test/request.test.ts`

**Interfaces:**

- Produces:
  - `ERROR_CODES` gains `invalid_request`, `meeting_not_found` and `unauthorized`.
  - `class ApiError extends Error { readonly code: ErrorCode }` in `@/lib/api/respond`. Throwing it inside `withErrors` sends that code's envelope and status, and logs nothing.
  - `parseInput<S extends z.ZodType>(schema: S, value: unknown): z.output<S>`: throws `ApiError("invalid_request")` when the value doesn't match.
  - `readJsonBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>>`: returns `invalid_request` for a body that isn't JSON or doesn't match.

- [ ] **Step 1: Failing tests.** Append to the `withErrors` describe in `apps/web/test/respond.test.ts` (and add `ApiError` to the import from `@/lib/api/respond`):

```ts
it("sends an ApiError's code and status without logging anything", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const handler = withErrors((_req: Request): Response => {
    throw new ApiError("meeting_not_found");
  });
  const res = await handler(new Request("http://test/api"));
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({
    error: {
      code: "meeting_not_found",
      message: "We couldn't find that meeting. It may have been removed from the meeting list.",
    },
  });
  expect(log).not.toHaveBeenCalled();
});
```

Create `apps/web/test/request.test.ts`:

```ts
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { readJsonBody } from "@/lib/api/request";
import { withErrors } from "@/lib/api/respond";

const Body = z.object({ n: z.number().int() });
const echo = withErrors(async (req: Request) => Response.json(await readJsonBody(req, Body)));

function post(body: string) {
  return echo(new Request("http://test/api", { method: "POST", body }));
}

describe("readJsonBody", () => {
  it("returns the parsed body", async () => {
    expect(await (await post('{"n":3}')).json()).toEqual({ n: 3 });
  });

  it.each(["not json", "", '{"n":"3"}', '{"n":1.5}', "[]"])("rejects %j as invalid_request", async (body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "Something in that request wasn't right. Please update the app and try again.",
      },
    });
  });
});
```

(This test builds its response with `Response.json` on purpose, to isolate `readJsonBody`. Add an inline disable with its reason, `// eslint-disable-next-line no-restricted-syntax -- test handler echoes the parsed body`, on that line.)

- [ ] **Step 2: Run and see both fail.** Run `pnpm --filter web exec vitest run respond request`. Expected: FAIL (`ApiError` is not exported, and `@/lib/api/request` can't be resolved).

- [ ] **Step 3: Implement.** In `packages/shared/src/errors.ts`, replace `ERROR_CODES` and `ERROR_MESSAGES`:

```ts
// Each phase adds the codes its endpoints can return, together with the code that returns them.
const ERROR_CODES = ["invalid_request", "meeting_not_found", "unauthorized", "server_error"] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  invalid_request: "Something in that request wasn't right. Please update the app and try again.",
  meeting_not_found: "We couldn't find that meeting. It may have been removed from the meeting list.",
  unauthorized: "You don't have access to this.",
  server_error: "Something went wrong on our end. Please try again in a few minutes.",
};
```

In `apps/web/src/lib/api/respond.ts`, set `ERROR_STATUS` to `{ invalid_request: 400, unauthorized: 401, meeting_not_found: 404, server_error: 500 }`, add the class below `apiError`, and handle it first in `withErrors`'s `catch`:

```ts
// Throw inside withErrors for an expected failure; the client gets this code's message and nothing is logged.
export class ApiError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = "ApiError";
  }
}
```

```ts
    } catch (error) {
      if (error instanceof ApiError) return apiError(error.code);
      console.error("[api] unhandled error:", describeError(error));
      return apiError("server_error");
    }
```

Create `apps/web/src/lib/api/request.ts`:

```ts
import type { z } from "zod";

import { ApiError } from "@/lib/api/respond";

export function parseInput<Schema extends z.ZodType>(schema: Schema, value: unknown): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError("invalid_request");
  return parsed.data;
}

export async function readJsonBody<Schema extends z.ZodType>(
  req: Request,
  schema: Schema,
): Promise<z.output<Schema>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError("invalid_request");
  }
  return parseInput(schema, body);
}
```

In `docs/standards.md`, replace the "Error responses" row with:

```
| Error responses | Throw `new ApiError(code)` from `@/lib/api/respond` inside `withErrors`; it sends that code's envelope and logs nothing. Unexpected errors become `server_error` | lint (as above) |
| Request input (bodies, path and query params) | `readJsonBody(req, schema)` / `parseInput(schema, value)` from `@/lib/api/request`; a mismatch is `invalid_request` | review |
```

- [ ] **Step 4: Run.** Run `pnpm check`. Expected: PASS, and the `unauthorized` code is used from Task 11 onwards. knip default mode counts test usage, so it passes; `knip:production` runs at the end of the phase.

- [ ] **Step 5: Commit** with the message `feat(api): add ApiError, request parsing and the Phase 2 error codes`.

---

### Task 2: Full TLS verification on database connections

**Files:**

- Create: `apps/web/src/db/connection-url.ts`
- Modify: `apps/web/src/db/client.ts`, `apps/web/drizzle.config.ts`
- Test: `apps/web/test/connection-url.test.ts`

**Interfaces:**

- Produces: `withVerifiedTls(url: string | undefined): string | undefined` rewrites `sslmode=require|prefer|verify-ca` to `verify-full` and leaves everything else alone.

- [ ] **Step 1: Failing test.** Create `apps/web/test/connection-url.test.ts`:

```ts
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
```

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run connection-url`. Expected: FAIL (the module is missing).

- [ ] **Step 3: Implement** `apps/web/src/db/connection-url.ts`:

```ts
const WEAKENING_MODES = new Set(["require", "prefer", "verify-ca"]);

// pg 8 treats these modes as verify-full but will switch to libpq's weaker meaning in pg 9;
// ask for full certificate verification explicitly so the upgrade can't silently weaken TLS.
export function withVerifiedTls(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  const parsed = new URL(url);
  const mode = parsed.searchParams.get("sslmode");
  if (mode === null || !WEAKENING_MODES.has(mode)) return url;
  parsed.searchParams.set("sslmode", "verify-full");
  return parsed.toString();
}
```

In `client.ts`, set `connectionString: withVerifiedTls(readEnv("DATABASE_URL"))`, and export the executor type used by functions that run inside or outside a transaction:

```ts
export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
```

In `drizzle.config.ts`, set `const url = withVerifiedTls(readEnv("DATABASE_URL_UNPOOLED") ?? readEnv("DATABASE_URL")) ?? "";`, importing from `./src/db/connection-url`.

- [ ] **Step 4: Run** `pnpm check`. Expected: PASS. If knip flags `Executor` as unused, move that export into Task 8, its first consumer.

- [ ] **Step 5: Commit** with the message `fix(db): request verify-full TLS so pg 9 can't weaken Neon connections`.

---

### Task 3: Shared meeting contracts

**Files:**

- Create: `packages/shared/src/meetings.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/meetings.test.ts`

**Interfaces:**

- Produces:
  - `MEETING_TYPE_CODES`: the official Meeting Guide codes, without `TC` or `ONL`.
  - `MeetingSummary`: a zod schema and a type of the same name.
  - `MeetingSearchRequest`, `MeetingSearchResponse`, `OnlineMeetingsQuery`, `OnlineMeetingsResponse` and `MeetingDetailResponse`.

- [ ] **Step 1: Failing test.** Create `packages/shared/test/meetings.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { MeetingSearchRequest, MeetingSummary, OnlineMeetingsQuery } from "../src/index";

const summary = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  name: "Nooners",
  day: 1,
  time: "12:00",
  endTime: null,
  timezone: "America/Chicago",
  types: ["O", "12x12"],
  attendance: "hybrid",
  locationName: "St. Luke's",
  formattedAddress: "1 Main St, Nashville, TN 37203, USA",
  latitude: 36.16,
  longitude: -86.78,
  locationNotes: null,
  notes: null,
  groupName: null,
  conferenceUrl: "https://zoom.us/j/123",
  conferenceUrlNotes: null,
  conferencePhone: null,
  conferencePhoneNotes: null,
  sourceUrl: null,
};

describe("MeetingSearchRequest", () => {
  it("accepts coordinates rounded to 2 decimal places", () => {
    expect(MeetingSearchRequest.parse({ lat: 36.16, lng: -86.78, radiusKm: 25 })).toEqual({
      lat: 36.16,
      lng: -86.78,
      radiusKm: 25,
    });
  });

  it.each([
    { lat: 36.162, lng: -86.78, radiusKm: 25 },
    { lat: 36.16, lng: -86.7812, radiusKm: 25 },
    { lat: 91, lng: 0, radiusKm: 25 },
    { lat: 36.16, lng: -86.78, radiusKm: 0 },
    { lat: 36.16, lng: -86.78, radiusKm: 101 },
    { lat: 36.16, lng: -86.78, radiusKm: 2.5 },
  ])("rejects %j", (request) => {
    expect(MeetingSearchRequest.safeParse(request).success).toBe(false);
  });
});

describe("MeetingSummary", () => {
  it("accepts a well-formed meeting", () => {
    expect(MeetingSummary.parse(summary)).toEqual(summary);
  });

  it.each([
    { time: "7:00" },
    { day: 7 },
    { types: ["ONL"] },
    { attendance: "inactive" },
    { conferenceUrl: "javascript:alert(1)" },
  ])("rejects %j", (change) => {
    expect(MeetingSummary.safeParse({ ...summary, ...change }).success).toBe(false);
  });
});

describe("OnlineMeetingsQuery", () => {
  it("reads the day from a query string value", () => {
    expect(OnlineMeetingsQuery.parse({ day: "3" })).toEqual({ day: 3 });
  });

  it.each([null, "7", "-1", "x", "1.5"])("rejects day %j", (day) => {
    expect(OnlineMeetingsQuery.safeParse({ day }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter @mymeetingapp/shared test`. Expected: FAIL (the exports don't exist yet).

- [ ] **Step 3: Implement** `packages/shared/src/meetings.ts`:

```ts
import { z } from "zod";

// Official Meeting Guide type codes (github.com/code4recovery/spec data/types.json, 2026-09).
// TC (temporarily closed) and ONL (online) are left out: `attendance` already says both.
export const MEETING_TYPE_CODES = [
  "11",
  "12x12",
  "A",
  "ABSI",
  "AF",
  "AL",
  "AL-AN",
  "AM",
  "AR",
  "ASL",
  "B",
  "BA",
  "BE",
  "BG",
  "BI",
  "BRK",
  "C",
  "CAN",
  "CF",
  "D",
  "DA",
  "DB",
  "DD",
  "DE",
  "DR",
  "EL",
  "EN",
  "FA",
  "FI",
  "FF",
  "FR",
  "G",
  "GR",
  "H",
  "HE",
  "HI",
  "HR",
  "HU",
  "IS",
  "ITA",
  "JA",
  "KA",
  "KOR",
  "L",
  "LGBTQ",
  "LIT",
  "LS",
  "LT",
  "M",
  "MED",
  "ML",
  "MT",
  "N",
  "NB",
  "NDG",
  "NE",
  "NL",
  "NO",
  "O",
  "OUT",
  "P",
  "POA",
  "POC",
  "POL",
  "POR",
  "PUN",
  "RUS",
  "S",
  "SEN",
  "SK",
  "SL",
  "SM",
  "SP",
  "ST",
  "SV",
  "T",
  "TH",
  "TL",
  "TR",
  "TUR",
  "UK",
  "W",
  "X",
  "XB",
  "XT",
  "Y",
] as const;

const ATTENDANCE_OPTIONS = ["in_person", "hybrid", "online"] as const;

const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Text = z.string().nullable();
const WebUrl = z.url({ protocol: /^https?$/ }).nullable();

export const MeetingSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  day: z.number().int().min(0).max(6),
  time: ClockTime,
  endTime: ClockTime.nullable(),
  timezone: Text,
  types: z.array(z.enum(MEETING_TYPE_CODES)),
  attendance: z.enum(ATTENDANCE_OPTIONS),
  locationName: Text,
  formattedAddress: Text,
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  locationNotes: Text,
  notes: Text,
  groupName: Text,
  conferenceUrl: WebUrl,
  conferenceUrlNotes: Text,
  conferencePhone: Text,
  conferencePhoneNotes: Text,
  sourceUrl: WebUrl,
});
export type MeetingSummary = z.infer<typeof MeetingSummary>;

// Spec §2: the phone rounds to 2 decimals (about 1 km) before sending; anything more precise is refused.
const roundedCoordinate = (limit: number) =>
  z
    .number()
    .min(-limit)
    .max(limit)
    .refine((value) => Math.round(value * 100) / 100 === value, "Round to 2 decimal places");

export const MeetingSearchRequest = z.object({
  lat: roundedCoordinate(90),
  lng: roundedCoordinate(180),
  radiusKm: z.number().int().min(1).max(100),
});
export type MeetingSearchRequest = z.infer<typeof MeetingSearchRequest>;

export const MeetingSearchResponse = z.object({
  meetings: z.array(MeetingSummary.extend({ distanceKm: z.number() })),
});
export type MeetingSearchResponse = z.infer<typeof MeetingSearchResponse>;

export const OnlineMeetingsQuery = z.object({
  day: z
    .string()
    .regex(/^[0-6]$/)
    .transform(Number),
});

export const OnlineMeetingsResponse = z.object({ meetings: z.array(MeetingSummary) });
export type OnlineMeetingsResponse = z.infer<typeof OnlineMeetingsResponse>;

export const MeetingDetailResponse = z.object({ meeting: MeetingSummary });
export type MeetingDetailResponse = z.infer<typeof MeetingDetailResponse>;
```

(Let Prettier lay out the code list.) Add `export * from "./meetings";` to `index.ts`.

- [ ] **Step 4: Run** `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit** with the message `feat(shared): add meeting summary, search, online and detail contracts`.

---

### Task 4: PostGIS and the meeting data schema

**Files:**

- Create: `apps/web/src/db/schema/feeds.ts`, `apps/web/src/db/schema/meetings.ts`, and migrations `0001_enable-postgis.sql` (custom), `0002_meeting-data.sql` (generated) and `0003_meeting-location.sql` (custom)
- Modify: `apps/web/src/db/schema/index.ts`, `apps/web/test/db.ts`
- Test: `apps/web/test/meeting-schema.test.ts`

**Interfaces:**

- Produces:
  - `feeds`, `meetings`, `feedMeetings` and `addressGeocodes` tables.
  - `ENTITY_TYPES` and `type EntityType`.
  - `meetingLocation`: an SQL reference to the generated `meetings.location` geography column.

- [ ] **Step 1: Write the schema files.** They're declarative; Step 3 tests their behavior.

`apps/web/src/db/schema/feeds.ts`:

```ts
import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { sqlStringList } from "@/db/sql";

export const ENTITY_TYPES = ["area", "district", "intergroup", "central_office"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const feeds = pgTable(
  "feeds",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    entityType: text("entity_type", { enum: ENTITY_TYPES }).notNull(),
    state: text("state").notNull(),
    url: text("url").notNull().unique(),
    // Lower wins when two feeds list the same meeting.
    priority: integer("priority").notNull(),
    optedOut: boolean("opted_out").notNull().default(false),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error"),
    meetingCount: integer("meeting_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("feeds_entity_type_check", sql`${table.entityType} in (${sqlStringList(ENTITY_TYPES)})`),
    check("feeds_state_check", sql`${table.state} ~ '^[A-Z]{2}$'`),
  ],
);
```

`apps/web/src/db/schema/meetings.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { feeds } from "@/db/schema/feeds";
import { sqlStringList } from "@/db/sql";

const ATTENDANCE_OPTIONS = ["in_person", "hybrid", "online"] as const;
const GEOCODE_STATUSES = ["matched", "no_match"] as const;

// A real-world meeting. Tags and the API use its id. Display fields live on its primary source row.
export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    primaryFeedMeetingId: bigint("primary_feed_meeting_id", { mode: "number" }),
    day: smallint("day").notNull(),
    time: text("time").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    timezone: text("timezone"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("meetings_day_time_idx").on(table.day, table.time)],
);

// One source's listing of a meeting on one day, holding only allowlisted fields (spec §3).
export const feedMeetings = pgTable(
  "feed_meetings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    feedId: integer("feed_id")
      .notNull()
      .references(() => feeds.id),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id),
    sourceSlug: text("source_slug").notNull(),
    day: smallint("day").notNull(),
    time: text("time").notNull(),
    endTime: text("end_time"),
    timezone: text("timezone"),
    name: text("name").notNull(),
    types: text("types").array().notNull(),
    attendance: text("attendance", { enum: ATTENDANCE_OPTIONS }).notNull(),
    locationName: text("location_name"),
    formattedAddress: text("formatted_address"),
    addressKey: text("address_key"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    locationNotes: text("location_notes"),
    notes: text("notes"),
    groupName: text("group_name"),
    conferenceUrl: text("conference_url"),
    conferenceUrlNotes: text("conference_url_notes"),
    conferencePhone: text("conference_phone"),
    conferencePhoneNotes: text("conference_phone_notes"),
    sourceUrl: text("source_url"),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("feed_meetings_feed_slug_day_unique").on(table.feedId, table.sourceSlug, table.day),
    index("feed_meetings_meeting_idx").on(table.meetingId),
    index("feed_meetings_address_key_idx").on(table.addressKey),
    index("feed_meetings_conference_url_idx").on(table.conferenceUrl),
    check("feed_meetings_day_check", sql`${table.day} between 0 and 6`),
    check(
      "feed_meetings_attendance_check",
      sql`${table.attendance} in (${sqlStringList(ATTENDANCE_OPTIONS)})`,
    ),
  ],
);

// Census geocoder results, keyed by normalized address so every feed and re-sync reuses them.
export const addressGeocodes = pgTable(
  "address_geocodes",
  {
    addressKey: text("address_key").primaryKey(),
    status: text("status", { enum: GEOCODE_STATUSES }).notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("address_geocodes_status_check", sql`${table.status} in (${sqlStringList(GEOCODE_STATUSES)})`),
  ],
);

// Generated from latitude/longitude by migration 0003 (drizzle-kit can't emit geography columns correctly).
export const meetingLocation = sql.raw(`"meetings"."location"`);
```

`sqlStringList` only accepts `[a-z_]+`, and `in_person` qualifies. Add `export * from "./feeds";` and `export * from "./meetings";` to `schema/index.ts`.

- [ ] **Step 2: Write the failing test.** Create `apps/web/test/meeting-schema.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { feeds, meetingLocation, meetings } from "@/db/schema";

import { resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => pool.end());

describe("meetings.location", () => {
  it("is generated from latitude and longitude and supports radius queries", async () => {
    const [near] = await db
      .insert(meetings)
      .values({ day: 1, time: "12:00", latitude: 36.17, longitude: -86.78 })
      .returning();
    await db.insert(meetings).values({ day: 1, time: "12:00", latitude: 40.0, longitude: -86.78 });
    await db.insert(meetings).values({ day: 1, time: "12:00" });

    const center = sql`ST_SetSRID(ST_MakePoint(-86.78, 36.16), 4326)::geography`;
    const rows = await db
      .select({ id: meetings.id })
      .from(meetings)
      .where(sql`ST_DWithin(${meetingLocation}, ${center}, 5000)`);

    expect(rows).toEqual([{ id: near?.id }]);
  });
});

describe("feeds table", () => {
  const feed = {
    slug: "x",
    name: "X",
    entityType: "intergroup",
    state: "TN",
    url: "https://x.org/f",
    priority: 10,
  } as const;

  it("rejects a lowercase or long state code", async () => {
    const insert = db.insert(feeds).values({ ...feed, state: "tn" });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "feeds_state_check" } });
  });

  it("rejects an unknown entity type", async () => {
    // @ts-expect-error -- deliberately invalid entity type, to exercise the database constraint
    const insert = db.insert(feeds).values({ ...feed, entityType: "club" });
    await expect(insert).rejects.toMatchObject({ cause: { constraint: "feeds_entity_type_check" } });
  });
});
```

- [ ] **Step 3: Generate the migrations and run.**

```bash
cd apps/web
pnpm drizzle-kit generate --custom --name=enable-postgis
```

Put this in `drizzle/0001_enable-postgis.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

```bash
pnpm db:generate --name=meeting-data
pnpm drizzle-kit generate --custom --name=meeting-location
```

Put this in `drizzle/0003_meeting-location.sql`:

```sql
ALTER TABLE "meetings" ADD COLUMN "location" geography(Point, 4326) GENERATED ALWAYS AS (
  CASE WHEN "latitude" IS NULL OR "longitude" IS NULL THEN NULL
  ELSE ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography END
) STORED;
--> statement-breakpoint
CREATE INDEX "meetings_location_idx" ON "meetings" USING gist ("location");
```

Add the new tables to `test/db.ts`: `const APP_TABLES = ["feed_meetings", "meetings", "feeds", "address_geocodes", "tags"];`

Before the first `pnpm test` (the test database has no PostGIS yet), run `docker compose exec -T db psql -U mma -d mma_test -c "drop schema public cascade; create schema public; drop schema if exists drizzle cascade;"` so global setup migrates it from scratch. The same applies to `mma_dev` before `pnpm --filter web db:migrate`.

Run `pnpm --filter web exec vitest run meeting-schema`. Expected: PASS. Check the three constraint names first: if a test fails on its name, read the generated SQL, since drizzle names the unique constraint as written above.

- [ ] **Step 4: Run** `pnpm check`. Expected: PASS, including `check:migrations`: the committed migrations match the schema, and the hand-written 0003 isn't in the snapshot, which is expected.

- [ ] **Step 5: Update the standards.** Add this row to `docs/standards.md` below "Schema changes":

```
| Columns drizzle-kit can't emit (PostGIS geography) | a `drizzle-kit generate --custom` migration, plus an `sql.raw` column reference exported from the schema file (e.g. `meetingLocation`) | review |
```

Commit with the message `feat(db): add PostGIS, feeds, meetings, feed_meetings and address_geocodes`.

---

### Task 5: The feed normalizer

**Files:**

- Create: `apps/web/src/server/feeds/address.ts`, `apps/web/src/server/feeds/normalize.ts`
- Test: `apps/web/test/address.test.ts`, `apps/web/test/normalize.test.ts`

**Interfaces:**

- Consumes: `MEETING_TYPE_CODES` and `MeetingSummary` (Task 3).
- Produces:
  - `addressKey(address: string | null): string | null`.
  - `interface FeedMeeting`, with these fields:
    - `sourceSlug`, `name`: string
    - `day`: number
    - `time`: string, and `endTime`: string | null
    - `timezone`: string | null
    - `types`: MeetingSummary["types"]
    - `attendance`: MeetingSummary["attendance"]
    - `locationName`, `formattedAddress`, `addressKey`: string | null
    - `latitude`, `longitude`: number | null
    - `locationNotes`, `notes`, `groupName`: string | null
    - `conferenceUrl`, `conferenceUrlNotes`, `conferencePhone`, `conferencePhoneNotes`: string | null
    - `sourceUrl`: string | null
  - `class FeedFormatError extends Error`.
  - `normalizeFeed(json: unknown): { meetings: FeedMeeting[]; skipped: number }`.

- [ ] **Step 1: Failing tests.** Create `apps/web/test/address.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { addressKey } from "@/server/feeds/address";

describe("addressKey", () => {
  it.each([
    ["6901 Central Ave, Lemon Grove, CA 91945, USA", "6901 central ave lemon grove ca 91945"],
    ["6901 Central Avenue, Lemon Grove, CA 91945", "6901 central ave lemon grove ca 91945"],
    [
      "6901  CENTRAL AVE.,Lemon Grove CA 91945 United States of America",
      "6901 central ave lemon grove ca 91945",
    ],
    ["100 North Main Street, Suite 5, Nashville, TN", "100 n main st ste 5 nashville tn"],
  ])("normalizes %j", (address, key) => {
    expect(addressKey(address)).toBe(key);
  });

  it.each([null, "", " , ", "USA"])("has no key for %j", (address) => {
    expect(addressKey(address)).toBeNull();
  });
});
```

Create `apps/web/test/normalize.test.ts`. The fixtures are trimmed copies of real feeds (research, 2026-09-26):

```ts
import { describe, expect, it } from "vitest";

import { FeedFormatError, normalizeFeed } from "@/server/feeds/normalize";

const tsmlInPerson = {
  id: 4887,
  name: "10 AND 11",
  slug: "10-and-11",
  notes: "Mo-Su",
  updated: "2026-03-25 16:15:24",
  url: "https://aasandiego.org/meetings/10-and-11/",
  day: 1,
  time: "05:00",
  types: ["11", "C", "EN"],
  location: "Club",
  formatted_address: "6901 Central Ave, Lemon Grove, CA 91945, USA",
  approximate: "no",
  latitude: 32.7384959,
  longitude: -117.0491894,
  timezone: "America/Los_Angeles",
  group: "3245",
  attendance_option: "in_person",
  entity: "Alcoholics Anonymous San Diego",
  entity_url: "https://aasandiego.org",
  feedback_emails: ["office@example.org"],
  contact_1_name: "Pat",
  contact_1_email: "pat@example.org",
  contact_1_phone: "555-0100",
  email: "group@example.org",
  phone: "555-0101",
  venmo: "@group",
};

const tsmlOnline = {
  name: "STEPS 10 & 11 @ 5AM ONLINE",
  slug: "steps-online",
  day: 1,
  time: "05:00",
  types: ["C", "D", "ONL"],
  conference_url: "https://zoom.us/j/1",
  approximate: "yes",
  formatted_address: "San Diego, CA, USA",
};

describe("normalizeFeed", () => {
  it("keeps only allowlisted fields of an in-person meeting", () => {
    const { meetings, skipped } = normalizeFeed([tsmlInPerson]);
    expect(skipped).toBe(0);
    expect(meetings).toEqual([
      {
        sourceSlug: "10-and-11",
        day: 1,
        time: "05:00",
        endTime: null,
        timezone: "America/Los_Angeles",
        name: "10 AND 11",
        types: ["11", "C", "EN"],
        attendance: "in_person",
        locationName: "Club",
        formattedAddress: "6901 Central Ave, Lemon Grove, CA 91945, USA",
        addressKey: "6901 central ave lemon grove ca 91945",
        latitude: 32.7384959,
        longitude: -117.0491894,
        locationNotes: null,
        notes: "Mo-Su",
        groupName: "3245",
        conferenceUrl: null,
        conferenceUrlNotes: null,
        conferencePhone: null,
        conferencePhoneNotes: null,
        sourceUrl: "https://aasandiego.org/meetings/10-and-11/",
      },
    ]);
    expect(JSON.stringify(meetings)).not.toMatch(/pat@example|555-01|@group|office@example|group@example/);
  });

  it("treats an approximate location with a conference link as online, dropping the approximate address", () => {
    const [meeting] = normalizeFeed([tsmlOnline]).meetings;
    expect(meeting).toMatchObject({
      attendance: "online",
      formattedAddress: null,
      addressKey: null,
      latitude: null,
      longitude: null,
      types: ["C", "D"],
      conferenceUrl: "https://zoom.us/j/1",
    });
  });

  it("marks an in-person meeting with a conference link as hybrid", () => {
    const [meeting] = normalizeFeed([{ ...tsmlInPerson, conference_phone: "+1 555 0100,,123#" }]).meetings;
    expect(meeting?.attendance).toBe("hybrid");
  });

  it("treats a temporarily closed location with no link as inactive and skips it", () => {
    expect(normalizeFeed([{ ...tsmlInPerson, types: ["C", "TC"] }])).toEqual({ meetings: [], skipped: 1 });
  });

  it("expands a meeting listed on several days into one row per day", () => {
    const days = normalizeFeed([{ ...tsmlInPerson, day: [1, "3", "Friday"] }]).meetings.map((m) => m.day);
    expect(days).toEqual([1, 3, 5]);
  });

  it("reads Google Sheets style coordinates and normalizes times", () => {
    const sheetRow = {
      slug: 7,
      name: "Women's Book Study",
      day: "2",
      time: "5:00",
      end_time: "18:00:00",
      formatted_address: "1200 Blossom Hill Rd, San Jose, CA 95118, USA",
      coordinates: "37.24887,-121.87943",
    };
    expect(normalizeFeed([sheetRow]).meetings[0]).toMatchObject({
      sourceSlug: "7",
      day: 2,
      time: "05:00",
      endTime: "18:00",
      latitude: 37.24887,
      longitude: -121.87943,
    });
  });

  it("builds an address from separate fields", () => {
    const row = {
      slug: "a",
      name: "A",
      day: 0,
      time: "19:00",
      address: "1 Main St",
      city: "Nashville",
      state: "TN",
      postal_code: "37203",
      country: "US",
    };
    expect(normalizeFeed([row]).meetings[0]?.formattedAddress).toBe("1 Main St, Nashville, TN 37203, US");
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "/relative/path", "ftp://x.org/a"])(
    "never keeps the unsafe URL %j",
    (url) => {
      const [meeting] = normalizeFeed([{ ...tsmlInPerson, url, conference_url: url }]).meetings;
      expect(meeting?.sourceUrl).toBeNull();
      expect(meeting?.conferenceUrl).toBeNull();
    },
  );

  it("drops unknown type codes, matches codes case-insensitively and keeps the official spelling", () => {
    expect(
      normalizeFeed([{ ...tsmlInPerson, types: ["o", "12X12", "ZZZ", "onl"] }]).meetings[0]?.types,
    ).toEqual(["O", "12x12"]);
  });

  it("drops an invalid time zone and impossible coordinates", () => {
    const [meeting] = normalizeFeed([
      { ...tsmlInPerson, timezone: "Mars/Olympus", latitude: 0, longitude: 0 },
    ]).meetings;
    expect(meeting).toMatchObject({
      timezone: null,
      latitude: null,
      longitude: null,
      attendance: "in_person",
    });
  });

  it.each([
    { ...tsmlInPerson, day: undefined },
    { ...tsmlInPerson, time: "noon" },
    { ...tsmlInPerson, time: "24:00" },
    { ...tsmlInPerson, slug: "" },
    { ...tsmlInPerson, name: "   " },
    "not an object",
    null,
  ])("skips %j", (row) => {
    expect(normalizeFeed([row])).toEqual({ meetings: [], skipped: 1 });
  });

  it("keeps the first row when a feed repeats a slug on the same day", () => {
    const { meetings } = normalizeFeed([tsmlInPerson, { ...tsmlInPerson, name: "Duplicate" }]);
    expect(meetings.map((m) => m.name)).toEqual(["10 AND 11"]);
  });

  it.each([{ meetings: [] }, "[]", null])("rejects %j as not a feed", (json) => {
    expect(() => normalizeFeed(json)).toThrow(FeedFormatError);
  });
});
```

(Let Prettier reflow the fixture objects.)

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run address normalize`. Expected: FAIL (the modules are missing).

- [ ] **Step 3: Implement** `apps/web/src/server/feeds/address.ts`:

```ts
const ABBREVIATIONS: Record<string, string> = {
  street: "st",
  avenue: "ave",
  road: "rd",
  drive: "dr",
  boulevard: "blvd",
  lane: "ln",
  court: "ct",
  place: "pl",
  parkway: "pkwy",
  highway: "hwy",
  suite: "ste",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
};

// Two feeds' spellings of one address should produce the same key (spec §3 matching).
export function addressKey(address: string | null): string | null {
  if (address === null) return null;
  const words = address
    .toLowerCase()
    .replace(/\b(usa|united states(?: of america)?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "")
    .map((word) => ABBREVIATIONS[word] ?? word);
  return words.length > 0 ? words.join(" ") : null;
}
```

`apps/web/src/server/feeds/normalize.ts`:

```ts
import { MEETING_TYPE_CODES, type MeetingSummary } from "@mymeetingapp/shared";

import { addressKey } from "@/server/feeds/address";

export interface FeedMeeting {
  sourceSlug: string;
  day: number;
  time: string;
  endTime: string | null;
  timezone: string | null;
  name: string;
  types: MeetingSummary["types"];
  attendance: MeetingSummary["attendance"];
  locationName: string | null;
  formattedAddress: string | null;
  addressKey: string | null;
  latitude: number | null;
  longitude: number | null;
  locationNotes: string | null;
  notes: string | null;
  groupName: string | null;
  conferenceUrl: string | null;
  conferenceUrlNotes: string | null;
  conferencePhone: string | null;
  conferencePhoneNotes: string | null;
  sourceUrl: string | null;
}

export class FeedFormatError extends Error {
  override name = "FeedFormatError";
}

type Raw = Record<string, unknown>;

const TEXT_LIMIT = 1000;
const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const TYPE_BY_UPPER = new Map(MEETING_TYPE_CODES.map((code) => [code.toUpperCase(), code]));

function text(value: unknown): string | null {
  const candidate = typeof value === "number" ? String(value) : value;
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  return trimmed === "" ? null : trimmed.slice(0, TEXT_LIMIT);
}

function webUrl(value: unknown): string | null {
  const candidate = text(value);
  if (candidate === null || !/^https?:\/\//i.test(candidate)) return null;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

function days(value: unknown): number[] {
  const found = new Set<number>();
  for (const item of Array.isArray(value) ? value : [value]) {
    const name = text(item)?.toLowerCase();
    const day =
      typeof item === "number"
        ? item
        : name !== undefined && /^\d$/.test(name)
          ? Number(name)
          : DAY_NAMES.indexOf(name ?? "");
    if (Number.isInteger(day) && day >= 0 && day <= 6) found.add(day);
  }
  return [...found];
}

function clockTime(value: unknown): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text(value) ?? "");
  if (match === null) return null;
  const [, hours = "", minutes = ""] = match;
  if (Number(hours) > 23 || Number(minutes) > 59) return null;
  return `${hours.padStart(2, "0")}:${minutes}`;
}

function timeZone(value: unknown): string | null {
  const zone = text(value);
  if (zone === null || !zone.includes("/")) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

function coordinate(value: unknown, limit: number): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

function point(raw: Raw): { latitude: number; longitude: number } | null {
  let latitude = coordinate(raw.latitude, 90);
  let longitude = coordinate(raw.longitude, 180);
  if ((latitude === null || longitude === null) && typeof raw.coordinates === "string") {
    const parts = raw.coordinates.split(",");
    if (parts.length === 2) {
      latitude = coordinate(parts[0], 90);
      longitude = coordinate(parts[1], 180);
    }
  }
  if (latitude === null || longitude === null || (latitude === 0 && longitude === 0)) return null;
  return { latitude, longitude };
}

// Online meetings often carry a city-level "approximate" location, which must not become a map pin.
function isApproximate(raw: Raw): boolean {
  if (raw.approximate === true || text(raw.approximate)?.toLowerCase() === "yes") return true;
  return typeof raw.coordinates === "string" && raw.coordinates.split(",").length === 4;
}

function address(raw: Raw): string | null {
  const formatted = text(raw.formatted_address);
  if (formatted !== null) return formatted;
  const stateAndZip = [text(raw.state), text(raw.postal_code)].filter((part) => part !== null).join(" ");
  const parts = [text(raw.address), text(raw.city), text(stateAndZip), text(raw.country)].filter(
    (part) => part !== null,
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

function rawTypes(value: unknown): string[] {
  const values: unknown[] = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return values.map((item) => text(item)?.toUpperCase()).filter((code) => code !== undefined);
}

function normalizeMeeting(value: unknown): FeedMeeting[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const raw = value as Raw;
  const sourceSlug = text(raw.slug);
  const name = text(raw.name);
  const time = clockTime(raw.time);
  const meetingDays = days(raw.day);
  if (sourceSlug === null || name === null || time === null || meetingDays.length === 0) return [];

  const upperTypes = rawTypes(raw.types);
  const approximate = isApproximate(raw);
  const formattedAddress = approximate ? null : address(raw);
  const location = approximate ? null : point(raw);
  const conferenceUrl = webUrl(raw.conference_url);
  const conferencePhone = text(raw.conference_phone);
  const online = conferenceUrl !== null || conferencePhone !== null;
  const inPerson = !upperTypes.includes("TC") && (formattedAddress !== null || location !== null);
  if (!inPerson && !online) return [];

  const meeting: Omit<FeedMeeting, "day"> = {
    sourceSlug,
    time,
    endTime: clockTime(raw.end_time),
    timezone: timeZone(raw.timezone),
    name,
    types: [
      ...new Set(upperTypes.map((code) => TYPE_BY_UPPER.get(code)).filter((code) => code !== undefined)),
    ],
    attendance: inPerson ? (online ? "hybrid" : "in_person") : "online",
    locationName: text(raw.location),
    formattedAddress,
    addressKey: addressKey(formattedAddress),
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    locationNotes: text(raw.location_notes),
    notes: text(raw.notes),
    groupName: text(raw.group),
    conferenceUrl,
    conferenceUrlNotes: text(raw.conference_url_notes),
    conferencePhone,
    conferencePhoneNotes: text(raw.conference_phone_notes),
    sourceUrl: webUrl(raw.url),
  };
  return meetingDays.map((day) => ({ ...meeting, day }));
}

// Spec §3 allowlist: only the fields above are read, so contact and payment fields never enter the system.
export function normalizeFeed(json: unknown): { meetings: FeedMeeting[]; skipped: number } {
  if (!Array.isArray(json)) throw new FeedFormatError("Feed is not a JSON array of meetings");
  const meetings: FeedMeeting[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const item of json) {
    const rows = normalizeMeeting(item);
    if (rows.length === 0) skipped += 1;
    for (const row of rows) {
      const key = `${row.sourceSlug}|${String(row.day)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      meetings.push(row);
    }
  }
  return { meetings, skipped };
}
```

`value as Raw` follows a runtime check, which the standards allow.

- [ ] **Step 4: Run** `pnpm --filter web exec vitest run address normalize`, then `pnpm check`. Expected: PASS. If a lint rule rejects `new Intl.DateTimeFormat(...)` as an unused expression, assign the result to `_` and drop it with `void`. The `country: "US"` fixture shows that a two-letter country code is kept, while "USA" and "United States" are removed only from the address key.

- [ ] **Step 5: Commit** with the message `feat(feeds): normalize Meeting Guide JSON into allowlisted feed meetings`.

---

### Task 6: Polite feed fetching

**Files:**

- Create: `packages/shared/src/brand.ts`, `apps/web/src/server/feeds/throttle.ts`, `apps/web/src/server/feeds/fetch-feed.ts`, `apps/web/test/http-server.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `apps/web/test/fetch-feed.test.ts`

**Interfaces:**

- Produces:
  - `BRAND = { appName: "mymeetingapp", domain: "mymeetingapp.com", contactEmail: "support@mymeetingapp.com" }`.
  - `createHostThrottle(): HostThrottle` with `wait(host: string): Promise<void>`, allowing one request per second per host.
  - `fetchFeed(url: string, cache: { etag: string | null; lastModified: string | null }, throttle: HostThrottle): Promise<FeedFetchResult>`, which returns one of:
    - `{ kind: "ok"; body: unknown; etag: string | null; lastModified: string | null }`
    - `{ kind: "not_modified" }`
    - `{ kind: "error"; message: string }`
  - The test helper `startServer(handler) → Promise<{ baseUrl: string; requests: RecordedRequest[]; close(): Promise<void> }>`.

- [ ] **Step 1: Write the test helper** `apps/web/test/http-server.ts`. Tests use a real local server, never a mocked `fetch`:

```ts
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedRequest {
  path: string;
  headers: IncomingHttpHeaders;
  at: number;
}

interface Reply {
  status: number;
  body?: string;
  headers?: Record<string, string>;
}

export async function startServer(handler: (path: string, headers: IncomingHttpHeaders) => Reply) {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    requests.push({ path, headers: req.headers, at: Date.now() });
    const reply = handler(path, req.headers);
    res.writeHead(reply.status, reply.headers);
    res.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    port,
    requests,
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}
```

- [ ] **Step 2: Failing test.** Create `apps/web/test/fetch-feed.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";

import { fetchFeed } from "@/server/feeds/fetch-feed";
import { createHostThrottle } from "@/server/feeds/throttle";

import { startServer } from "./http-server";

const noCache = { etag: null, lastModified: null };
const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function serve(...args: Parameters<typeof startServer>) {
  const server = await startServer(...args);
  servers.push(server);
  return server;
}

describe("fetchFeed", () => {
  it("returns the parsed body and caching headers, identifying itself with a contact email", async () => {
    const server = await serve(() => ({
      status: 200,
      body: '[{"slug":"a"}]',
      headers: {
        "Content-Type": "application/json",
        ETag: '"v1"',
        "Last-Modified": "Sat, 26 Sep 2026 10:00:00 GMT",
      },
    }));
    const result = await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle());
    expect(result).toEqual({
      kind: "ok",
      body: [{ slug: "a" }],
      etag: '"v1"',
      lastModified: "Sat, 26 Sep 2026 10:00:00 GMT",
    });
    expect(server.requests[0]?.headers["user-agent"]).toBe(
      "mymeetingapp/1.0 (+https://mymeetingapp.com; support@mymeetingapp.com)",
    );
  });

  it("sends conditional headers and reports an unchanged feed", async () => {
    const server = await serve(() => ({ status: 304 }));
    const result = await fetchFeed(
      `${server.baseUrl}/feed`,
      { etag: '"v1"', lastModified: "Sat, 26 Sep 2026 10:00:00 GMT" },
      createHostThrottle(),
    );
    expect(result).toEqual({ kind: "not_modified" });
    expect(server.requests[0]?.headers).toMatchObject({
      "if-none-match": '"v1"',
      "if-modified-since": "Sat, 26 Sep 2026 10:00:00 GMT",
    });
  });

  it.each([
    [403, "restricted (HTTP 403)"],
    [401, "restricted (HTTP 401)"],
    [500, "HTTP 500"],
  ])("reports HTTP %i as %j", async (status, message) => {
    const server = await serve(() => ({ status, body: "{}" }));
    expect(await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle())).toEqual({
      kind: "error",
      message,
    });
  });

  it("reports a body that isn't JSON", async () => {
    const server = await serve(() => ({ status: 200, body: "<html>" }));
    expect(await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle())).toEqual({
      kind: "error",
      message: "not valid JSON",
    });
  });

  it("reports a host that refuses connections", async () => {
    const server = await serve(() => ({ status: 200 }));
    await server.close();
    servers.pop();
    expect(await fetchFeed(`${server.baseUrl}/feed`, noCache, createHostThrottle())).toEqual({
      kind: "error",
      message: "could not connect",
    });
  });

  it("waits a second between requests to the same host, but not across hosts", async () => {
    const server = await serve(() => ({ status: 200, body: "[]" }));
    const throttle = createHostThrottle();
    await fetchFeed(`${server.baseUrl}/a`, noCache, throttle);
    await fetchFeed(`http://localhost:${String(server.port)}/b`, noCache, throttle);
    await fetchFeed(`${server.baseUrl}/c`, noCache, throttle);
    const [first, otherHost, sameHost] = server.requests.map((request) => request.at);
    expect((otherHost ?? 0) - (first ?? 0)).toBeLessThan(500);
    expect((sameHost ?? 0) - (first ?? 0)).toBeGreaterThanOrEqual(990);
  });
});
```

- [ ] **Step 3: Run** `pnpm --filter web exec vitest run fetch-feed`. Expected: FAIL (the modules are missing).

- [ ] **Step 4: Implement.** `packages/shared/src/brand.ts` (export it from `index.ts`):

```ts
export const BRAND = {
  appName: "mymeetingapp",
  domain: "mymeetingapp.com",
  contactEmail: "support@mymeetingapp.com",
} as const;
```

`apps/web/src/server/feeds/throttle.ts`:

```ts
const REQUEST_INTERVAL_MS = 1000;

// Spec §3 politeness: at most one request per second to any host during a sync run.
export function createHostThrottle() {
  const nextAllowed = new Map<string, number>();
  return {
    async wait(host: string): Promise<void> {
      const now = Date.now();
      const at = Math.max(now, nextAllowed.get(host) ?? 0);
      nextAllowed.set(host, at + REQUEST_INTERVAL_MS);
      if (at > now) await new Promise((resolve) => setTimeout(resolve, at - now));
    },
  };
}

export type HostThrottle = ReturnType<typeof createHostThrottle>;
```

`apps/web/src/server/feeds/fetch-feed.ts`:

```ts
import { BRAND } from "@mymeetingapp/shared";

import type { HostThrottle } from "@/server/feeds/throttle";

const TIMEOUT_MS = 30_000;
const MAX_BYTES = 50 * 1024 * 1024;
export const USER_AGENT = `${BRAND.appName}/1.0 (+https://${BRAND.domain}; ${BRAND.contactEmail})`;

export type FeedFetchResult =
  | { kind: "ok"; body: unknown; etag: string | null; lastModified: string | null }
  | { kind: "not_modified" }
  | { kind: "error"; message: string };

export async function fetchFeed(
  url: string,
  cache: { etag: string | null; lastModified: string | null },
  throttle: HostThrottle,
): Promise<FeedFetchResult> {
  const target = new URL(url);
  await throttle.wait(target.host);
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/json" };
  if (cache.etag !== null) headers["If-None-Match"] = cache.etag;
  if (cache.lastModified !== null) headers["If-Modified-Since"] = cache.lastModified;

  let response: Response;
  try {
    response = await fetch(target, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not connect",
    };
  }
  if (response.status === 304) return { kind: "not_modified" };
  if (response.status === 401 || response.status === 403) {
    return { kind: "error", message: `restricted (HTTP ${String(response.status)})` };
  }
  if (!response.ok) return { kind: "error", message: `HTTP ${String(response.status)}` };
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES)
    return { kind: "error", message: "too large" };

  const text = await response.text();
  if (text.length > MAX_BYTES) return { kind: "error", message: "too large" };
  try {
    return {
      kind: "ok",
      body: JSON.parse(text),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  } catch {
    return { kind: "error", message: "not valid JSON" };
  }
}
```

If knip flags `USER_AGENT` as an unused export, make it module-private. Task 10 reuses it for the geocoder; export it again then.

- [ ] **Step 5: Run** `pnpm --filter web exec vitest run fetch-feed`, then `pnpm check`. Expected: PASS. Then commit with the message `feat(feeds): fetch feeds politely with conditional requests and a per-host throttle`.

- [ ] **Step 6: Tell the user** that `support@mymeetingapp.com` must exist before the first production sync, because it's in the User-Agent. It's on the roadmap's accounts checklist.

---

### Task 7: Registering feeds

**Files:**

- Create: `apps/web/src/db/upsert-feed.ts`, `apps/web/scripts/add-feed.ts`
- Modify: `apps/web/package.json` (add the `db:add-feed` script)
- Test: `apps/web/test/upsert-feed.test.ts`

**Interfaces:**

- Consumes: `feeds`, `ENTITY_TYPES` and `EntityType` (Task 4).
- Produces:
  - `FeedInput`, a zod schema taking `{ slug, name, entityType, state, url, priority? }`.
  - `upsertFeed(input: z.input<typeof FeedInput>): Promise<number>`, which returns the feed id. `priority` defaults by entity type (intergroup, district and central office 10, area 20).
  - The CLI `pnpm --filter web db:add-feed --slug … --name … --entity-type … --state … --url … [--priority N]`.

- [ ] **Step 1: Failing test.** Create `apps/web/test/upsert-feed.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { feeds } from "@/db/schema";
import { upsertFeed } from "@/db/upsert-feed";

import { resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => pool.end());

const input = {
  slug: "sd",
  name: "San Diego",
  entityType: "central_office",
  state: "CA",
  url: "https://aasandiego.org/wp-json/tsml/meetings",
} as const;

async function feedRow(slug: string) {
  const [row] = await db.select().from(feeds).where(eq(feeds.slug, slug));
  return row;
}

describe("upsertFeed", () => {
  it.each([
    ["intergroup", 10],
    ["district", 10],
    ["central_office", 10],
    ["area", 20],
  ] as const)("gives a %s feed priority %i by default", async (entityType, priority) => {
    await upsertFeed({ ...input, entityType });
    expect((await feedRow("sd"))?.priority).toBe(priority);
  });

  it("updates an existing feed by slug but never changes its opt-out", async () => {
    const id = await upsertFeed(input);
    await db.update(feeds).set({ optedOut: true }).where(eq(feeds.id, id));
    expect(await upsertFeed({ ...input, name: "AA San Diego", priority: 5 })).toBe(id);
    expect(await feedRow("sd")).toMatchObject({ name: "AA San Diego", priority: 5, optedOut: true });
  });

  it.each([{ state: "ca" }, { url: "ftp://x.org/feed" }, { slug: "Has Spaces" }, { priority: 0 }])(
    "rejects %j",
    async (change) => {
      await expect(upsertFeed({ ...input, ...change })).rejects.toThrow();
    },
  );
});
```

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run upsert-feed`. Expected: FAIL (the module is missing).

- [ ] **Step 3: Implement** `apps/web/src/db/upsert-feed.ts`:

```ts
import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { ENTITY_TYPES, type EntityType, feeds } from "@/db/schema";

// Spec §3: intergroup and district feeds outrank area feeds, which often re-publish them.
const DEFAULT_PRIORITY: Record<EntityType, number> = {
  intergroup: 10,
  district: 10,
  central_office: 10,
  area: 20,
};

export const FeedInput = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().trim().min(1),
  entityType: z.enum(ENTITY_TYPES),
  state: z.string().regex(/^[A-Z]{2}$/),
  url: z.url({ protocol: /^https?$/ }),
  priority: z.number().int().min(1).optional(),
});

export async function upsertFeed(input: z.input<typeof FeedInput>): Promise<number> {
  const feed = FeedInput.parse(input);
  const values = { ...feed, priority: feed.priority ?? DEFAULT_PRIORITY[feed.entityType] };
  const [row] = await db
    .insert(feeds)
    .values(values)
    .onConflictDoUpdate({
      target: feeds.slug,
      set: {
        name: sql`excluded.name`,
        entityType: sql`excluded.entity_type`,
        state: sql`excluded.state`,
        url: sql`excluded.url`,
        priority: sql`excluded.priority`,
      },
    })
    .returning({ id: feeds.id });
  if (row === undefined) throw new Error("upsertFeed returned no row");
  return row.id;
}
```

`apps/web/scripts/add-feed.ts`:

```ts
import { parseArgs } from "node:util";

import { loadLocalEnvFile } from "@/env";

loadLocalEnvFile();

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
    name: { type: "string" },
    "entity-type": { type: "string" },
    state: { type: "string" },
    url: { type: "string" },
    priority: { type: "string" },
  },
});

// The database client reads DATABASE_URL when it is imported, so import it after loading the env file.
const { upsertFeed } = await import("@/db/upsert-feed");
const { pool } = await import("@/db/client");

try {
  const id = await upsertFeed({
    slug: values.slug ?? "",
    name: values.name ?? "",
    entityType: values["entity-type"] as never,
    state: values.state ?? "",
    url: values.url ?? "",
    priority: values.priority === undefined ? undefined : Number(values.priority),
  });
  console.log(`Feed ${String(id)} saved`);
} finally {
  await pool.end();
}
```

The `as never` hands an unchecked string to `FeedInput.parse`, which validates it. If lint rejects the cast, type the argument as `Parameters<typeof upsertFeed>[0]` built from `unknown` values and let zod report the errors. Add `"db:add-feed": "tsx scripts/add-feed.ts"` to `apps/web/package.json`.

- [ ] **Step 4: Run** `pnpm check`, then try it locally: `pnpm --filter web db:add-feed --slug sd --name "AA San Diego" --entity-type central_office --state CA --url https://aasandiego.org/wp-json/tsml/meetings`. Expected: `Feed 1 saved`.

- [ ] **Step 5: Commit** with the message `feat(feeds): register feeds with default priorities by entity type`.

---

### Task 8: Recomputing canonical meetings

**Files:**

- Create: `apps/web/src/server/meetings/recompute.ts`, `apps/web/test/feed-fixtures.ts`
- Test: `apps/web/test/recompute.test.ts`

**Interfaces:**

- Consumes: `Executor` (Task 2), the schema (Task 4), `FeedMeeting` (Task 5), `upsertFeed` (Task 7), and `@photostructure/tz-lookup`.
- Produces: `recomputeMeetings(meetingIds: string[], executor?: Executor): Promise<void>`. For each meeting it:
  - sets `primary_feed_meeting_id` to the active source from the non-opted-out feed with the lowest priority, breaking ties by lowest source id;
  - copies day and time;
  - takes coordinates from the source, or from `address_geocodes` when the source has none;
  - takes the time zone from the source, or looks it up from the coordinates;
  - clears `archived_at` when it has an active source and sets it otherwise.

  `executor` defaults to `db`; Task 9 passes a transaction.

- [ ] **Step 1: Test fixtures** (shared by Tasks 8–14). Create `apps/web/test/feed-fixtures.ts`:

```ts
import { db } from "@/db/client";
import { feedMeetings, meetings } from "@/db/schema";
import { upsertFeed } from "@/db/upsert-feed";
import type { FeedMeeting } from "@/server/feeds/normalize";

export function feedMeeting(overrides: Partial<FeedMeeting> = {}): FeedMeeting {
  return {
    sourceSlug: "nooners",
    day: 1,
    time: "12:00",
    endTime: null,
    timezone: "America/Chicago",
    name: "Nooners",
    types: ["O"],
    attendance: "in_person",
    locationName: "St. Luke's",
    formattedAddress: "1 Main St, Nashville, TN 37203, USA",
    addressKey: "1 main st nashville tn 37203",
    latitude: 36.17,
    longitude: -86.78,
    locationNotes: null,
    notes: null,
    groupName: null,
    conferenceUrl: null,
    conferenceUrlNotes: null,
    conferencePhone: null,
    conferencePhoneNotes: null,
    sourceUrl: null,
    ...overrides,
  };
}

export async function seedFeed(slug: string, entityType: "intergroup" | "area" = "intergroup") {
  return upsertFeed({ slug, name: slug, entityType, state: "TN", url: `https://${slug}.example.org/feed` });
}

// Inserts one meeting with the given sources directly, for tests of code that runs after matching.
export async function insertMeetingWithSources(
  sources: { feedId: number; row: FeedMeeting; archived?: boolean }[],
) {
  const [meeting] = await db
    .insert(meetings)
    .values({ day: sources[0]?.row.day ?? 1, time: sources[0]?.row.time ?? "12:00" })
    .returning();
  if (meeting === undefined) throw new Error("no meeting");
  for (const { feedId, row, archived } of sources) {
    await db.insert(feedMeetings).values({
      ...row,
      feedId,
      meetingId: meeting.id,
      seenAt: new Date(),
      archivedAt: archived === true ? new Date() : null,
    });
  }
  return meeting.id;
}
```

- [ ] **Step 2: Failing test.** Create `apps/web/test/recompute.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { addressGeocodes, feedMeetings, feeds, meetings } from "@/db/schema";
import { recomputeMeetings } from "@/server/meetings/recompute";

import { resetDb } from "./db";
import { feedMeeting, insertMeetingWithSources, seedFeed } from "./feed-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

async function meeting(id: string) {
  const [row] = await db.select().from(meetings).where(eq(meetings.id, id));
  return row;
}

async function sourceId(feedId: number) {
  const [row] = await db
    .select({ id: feedMeetings.id })
    .from(feedMeetings)
    .where(eq(feedMeetings.feedId, feedId));
  return row?.id;
}

describe("recomputeMeetings", () => {
  it("takes day, time, coordinates and time zone from the highest-priority active source", async () => {
    const area = await seedFeed("area-feed", "area");
    const intergroup = await seedFeed("intergroup-feed", "intergroup");
    const id = await insertMeetingWithSources([
      { feedId: area, row: feedMeeting({ time: "12:00", latitude: 36.1, timezone: "America/New_York" }) },
      {
        feedId: intergroup,
        row: feedMeeting({ time: "12:15", latitude: 36.2, timezone: "America/Chicago" }),
      },
    ]);
    await recomputeMeetings([id]);
    expect(await meeting(id)).toMatchObject({
      primaryFeedMeetingId: await sourceId(intergroup),
      time: "12:15",
      latitude: 36.2,
      timezone: "America/Chicago",
      archivedAt: null,
    });
  });

  it("skips archived sources and sources from opted-out feeds", async () => {
    const intergroup = await seedFeed("intergroup-feed");
    const optedOut = await seedFeed("opted-out-feed");
    const area = await seedFeed("area-feed", "area");
    await db.update(feeds).set({ optedOut: true }).where(eq(feeds.id, optedOut));
    const id = await insertMeetingWithSources([
      { feedId: intergroup, row: feedMeeting(), archived: true },
      { feedId: optedOut, row: feedMeeting() },
      { feedId: area, row: feedMeeting({ time: "12:30" }) },
    ]);
    await recomputeMeetings([id]);
    expect(await meeting(id)).toMatchObject({ primaryFeedMeetingId: await sourceId(area), time: "12:30" });
  });

  it("archives a meeting with no active source and restores it when one returns", async () => {
    const feedId = await seedFeed("intergroup-feed");
    const id = await insertMeetingWithSources([{ feedId, row: feedMeeting(), archived: true }]);
    await recomputeMeetings([id]);
    expect((await meeting(id))?.archivedAt).toBeInstanceOf(Date);
    await db.update(feedMeetings).set({ archivedAt: null }).where(eq(feedMeetings.feedId, feedId));
    await recomputeMeetings([id]);
    expect((await meeting(id))?.archivedAt).toBeNull();
  });

  it("uses a stored geocode when the source has no coordinates", async () => {
    const feedId = await seedFeed("intergroup-feed");
    const id = await insertMeetingWithSources([
      { feedId, row: feedMeeting({ latitude: null, longitude: null }) },
    ]);
    await db.insert(addressGeocodes).values({
      addressKey: "1 main st nashville tn 37203",
      status: "matched",
      latitude: 36.16,
      longitude: -86.78,
    });
    await recomputeMeetings([id]);
    expect(await meeting(id)).toMatchObject({ latitude: 36.16, longitude: -86.78 });
  });

  it("looks up the time zone from the coordinates when the source has none", async () => {
    const feedId = await seedFeed("intergroup-feed");
    const id = await insertMeetingWithSources([
      { feedId, row: feedMeeting({ timezone: null, latitude: 33.45, longitude: -112.07 }) },
    ]);
    await recomputeMeetings([id]);
    expect((await meeting(id))?.timezone).toBe("America/Phoenix");
  });
});
```

- [ ] **Step 3: Run** `pnpm --filter web exec vitest run recompute`. Expected: FAIL (the module is missing).

- [ ] **Step 4: Implement.** Run `pnpm --filter web add @photostructure/tz-lookup`, then create `apps/web/src/server/meetings/recompute.ts`:

```ts
import tzlookup from "@photostructure/tz-lookup";
import { and, inArray, isNull, isNotNull, sql } from "drizzle-orm";

import { db, type Executor } from "@/db/client";
import { meetings } from "@/db/schema";

// Spec §3: a canonical meeting shows its highest-priority active source and is archived once none remain.
export async function recomputeMeetings(meetingIds: string[], executor: Executor = db): Promise<void> {
  if (meetingIds.length === 0) return;
  const ids = sql`${sql.param(meetingIds)}::uuid[]`;

  await executor.execute(sql`
    with primary_source as (
      select distinct on (fm.meeting_id)
        fm.meeting_id, fm.id, fm.day, fm.time, fm.timezone, fm.address_key, fm.latitude, fm.longitude
      from feed_meetings fm
      join feeds f on f.id = fm.feed_id
      where fm.meeting_id = any(${ids}) and fm.archived_at is null and not f.opted_out
      order by fm.meeting_id, f.priority, fm.id
    )
    update meetings m set
      primary_feed_meeting_id = p.id,
      day = p.day,
      time = p.time,
      latitude = coalesce(p.latitude, g.latitude),
      longitude = coalesce(p.longitude, g.longitude),
      timezone = p.timezone,
      archived_at = null,
      updated_at = now()
    from primary_source p
    left join address_geocodes g on g.address_key = p.address_key and g.status = 'matched'
    where m.id = p.meeting_id
  `);

  await executor.execute(sql`
    update meetings m set archived_at = now(), updated_at = now()
    where m.id = any(${ids}) and m.archived_at is null and not exists (
      select 1 from feed_meetings fm join feeds f on f.id = fm.feed_id
      where fm.meeting_id = m.id and fm.archived_at is null and not f.opted_out
    )
  `);

  // Spec §3: the time zone comes from the feed when given, otherwise from the coordinates.
  const missingZone = await executor
    .select({ id: meetings.id, latitude: meetings.latitude, longitude: meetings.longitude })
    .from(meetings)
    .where(
      and(
        inArray(meetings.id, meetingIds),
        isNull(meetings.timezone),
        isNotNull(meetings.latitude),
        isNotNull(meetings.longitude),
      ),
    );
  for (const row of missingZone) {
    if (row.latitude === null || row.longitude === null) continue;
    await executor.execute(
      sql`update meetings set timezone = ${tzlookup(row.latitude, row.longitude)} where id = ${row.id}`,
    );
  }
}
```

(If `sql.param(array)` doesn't bind as a Postgres array with this driver, use `inArray` in a Drizzle update, or `sql\`${meetingIds}\``with the`::uuid[]`cast. The tests catch either mistake. If the default-import form of`@photostructure/tz-lookup`fails typechecking, use`import tzlookup = require(...)`-compatible interop; check its `index.d.ts`.)

- [ ] **Step 5: Run** `pnpm --filter web exec vitest run recompute`, then `pnpm check`. Expected: PASS. Then commit with the message `feat(meetings): recompute canonical meetings from their highest-priority source`.

---

### Task 9: Applying a feed snapshot with canonical matching

**Files:**

- Create: `apps/web/src/server/meetings/apply-feed.ts`
- Test: `apps/web/test/apply-feed.test.ts`

**Interfaces:**

- Consumes: `recomputeMeetings` (Task 8), `FeedMeeting` (Task 5), and the schema.
- Produces: `applyFeedSnapshot(feedId: number, rows: FeedMeeting[]): Promise<void>`. In one transaction it:
  1. matches or creates a canonical meeting for each new `(slug, day)`;
  2. upserts all rows with `seen_at = now` and `archived_at = null`;
  3. archives this feed's rows that weren't in the snapshot;
  4. recomputes every meeting the feed touches.

- [ ] **Step 1: Failing test.** Create `apps/web/test/apply-feed.test.ts`:

```ts
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { feedMeetings, meetings } from "@/db/schema";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";

import { resetDb } from "./db";
import { feedMeeting, seedFeed } from "./feed-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

async function activeMeetings() {
  return db.select().from(meetings).where(isNull(meetings.archivedAt));
}

async function meetingIdOf(feedId: number, sourceSlug: string) {
  const [row] = await db
    .select({ meetingId: feedMeetings.meetingId })
    .from(feedMeetings)
    .where(and(eq(feedMeetings.feedId, feedId), eq(feedMeetings.sourceSlug, sourceSlug)));
  return row?.meetingId;
}

describe("applyFeedSnapshot", () => {
  it("creates one canonical meeting per row", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting(), feedMeeting({ sourceSlug: "other", day: 2 })]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("is idempotent", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting()]);
    await applyFeedSnapshot(feedId, [feedMeeting()]);
    expect(await activeMeetings()).toHaveLength(1);
    expect(await db.select().from(feedMeetings)).toHaveLength(1);
  });

  it("joins the same meeting from another feed by normalized address", async () => {
    const intergroup = await seedFeed("intergroup");
    const area = await seedFeed("area", "area");
    await applyFeedSnapshot(intergroup, [feedMeeting()]);
    await applyFeedSnapshot(area, [
      feedMeeting({ sourceSlug: "area-slug", latitude: null, longitude: null }),
    ]);
    expect(await activeMeetings()).toHaveLength(1);
    expect(await meetingIdOf(area, "area-slug")).toBe(await meetingIdOf(intergroup, "nooners"));
  });

  it("joins by coordinates within 50 m when the addresses differ", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting()]);
    await applyFeedSnapshot(b, [
      feedMeeting({ sourceSlug: "b", addressKey: "different", latitude: 36.1702, longitude: -86.78 }),
    ]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("keeps meetings apart when the time differs or they are more than 50 m apart", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    await applyFeedSnapshot(a, [feedMeeting()]);
    await applyFeedSnapshot(b, [
      feedMeeting({ sourceSlug: "later", time: "12:30" }),
      feedMeeting({ sourceSlug: "far", addressKey: "elsewhere", latitude: 36.18, longitude: -86.78 }),
    ]);
    expect(await activeMeetings()).toHaveLength(3);
  });

  it("joins online-only meetings by conference URL", async () => {
    const a = await seedFeed("a");
    const b = await seedFeed("b");
    const online = {
      attendance: "online",
      formattedAddress: null,
      addressKey: null,
      latitude: null,
      longitude: null,
      conferenceUrl: "https://zoom.us/j/1",
    } as const;
    await applyFeedSnapshot(a, [feedMeeting({ ...online })]);
    await applyFeedSnapshot(b, [feedMeeting({ ...online, sourceSlug: "b" })]);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("keeps a renamed meeting (new slug) on the same canonical meeting", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting({ sourceSlug: "old-name" })]);
    const before = await meetingIdOf(feedId, "old-name");
    await applyFeedSnapshot(feedId, [feedMeeting({ sourceSlug: "new-name" })]);
    expect(await meetingIdOf(feedId, "new-name")).toBe(before);
    expect(await activeMeetings()).toHaveLength(1);
  });

  it("keeps two rooms at one address and time apart when the feed lists both", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [
      feedMeeting({ sourceSlug: "room-a" }),
      feedMeeting({ sourceSlug: "room-b" }),
    ]);
    expect(await activeMeetings()).toHaveLength(2);
  });

  it("archives rows missing from the snapshot and restores them when they return", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting(), feedMeeting({ sourceSlug: "gone", day: 3 })]);
    const goneId = await meetingIdOf(feedId, "gone");
    await applyFeedSnapshot(feedId, [feedMeeting()]);
    expect(await activeMeetings()).toHaveLength(1);
    await applyFeedSnapshot(feedId, [feedMeeting(), feedMeeting({ sourceSlug: "gone", day: 3 })]);
    expect(await meetingIdOf(feedId, "gone")).toBe(goneId);
    expect(await activeMeetings()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run apply-feed`. Expected: FAIL (the module is missing).

- [ ] **Step 3: Implement** `apps/web/src/server/meetings/apply-feed.ts`:

```ts
import { and, eq, isNull, lt, sql } from "drizzle-orm";

import { db, type Executor } from "@/db/client";
import { feedMeetings, meetingLocation, meetings } from "@/db/schema";
import type { FeedMeeting } from "@/server/feeds/normalize";
import { recomputeMeetings } from "@/server/meetings/recompute";

const MATCH_DISTANCE_METERS = 50;

// Spec §3 matching: same day and start time, plus the same normalized address, coordinates within 50 m,
// or (online only) the same conference URL. A meeting that this feed lists under another slug in the same
// snapshot is excluded, so two rooms at one address and time stay separate.
async function findMatchingMeeting(tx: Executor, feedId: number, row: FeedMeeting, snapshotSlugs: string[]) {
  const point =
    row.latitude !== null && row.longitude !== null
      ? sql`ST_SetSRID(ST_MakePoint(${row.longitude}, ${row.latitude}), 4326)::geography`
      : null;
  const result = await tx.execute<{ id: string }>(sql`
    select m.id from meetings m
    where m.day = ${row.day} and m.time = ${row.time}
      and (
        exists (
          select 1 from feed_meetings fm where fm.meeting_id = m.id and (
            (${row.addressKey}::text is not null and fm.address_key = ${row.addressKey})
            or (${row.attendance} = 'online' and fm.attendance = 'online' and fm.conference_url = ${row.conferenceUrl})
          )
        )
        ${point === null ? sql`` : sql`or ST_DWithin(${meetingLocation}, ${point}, ${MATCH_DISTANCE_METERS})`}
      )
      and not exists (
        select 1 from feed_meetings same_feed
        where same_feed.meeting_id = m.id and same_feed.feed_id = ${feedId} and same_feed.day = ${row.day}
          and same_feed.source_slug = any(${sql.param(snapshotSlugs)}::text[])
      )
    order by m.archived_at nulls first, m.created_at
    limit 1
  `);
  return result.rows[0]?.id;
}

export async function applyFeedSnapshot(feedId: number, rows: FeedMeeting[]): Promise<void> {
  await db.transaction(async (tx) => {
    const seenAt = new Date();
    const existing = await tx
      .select({
        sourceSlug: feedMeetings.sourceSlug,
        day: feedMeetings.day,
        meetingId: feedMeetings.meetingId,
      })
      .from(feedMeetings)
      .where(eq(feedMeetings.feedId, feedId));
    const meetingByKey = new Map(
      existing.map((row) => [`${row.sourceSlug}|${String(row.day)}`, row.meetingId]),
    );
    const snapshotSlugs = [...new Set(rows.map((row) => row.sourceSlug))];

    for (const row of rows) {
      const key = `${row.sourceSlug}|${String(row.day)}`;
      let meetingId = meetingByKey.get(key);
      if (meetingId === undefined) {
        meetingId = await findMatchingMeeting(tx, feedId, row, snapshotSlugs);
        if (meetingId === undefined) {
          const [created] = await tx
            .insert(meetings)
            .values({ day: row.day, time: row.time })
            .returning({ id: meetings.id });
          meetingId = created?.id;
        }
        if (meetingId === undefined) throw new Error("could not create a meeting");
        meetingByKey.set(key, meetingId);
      }
      await tx
        .insert(feedMeetings)
        .values({ ...row, feedId, meetingId, seenAt, archivedAt: null })
        .onConflictDoUpdate({
          target: [feedMeetings.feedId, feedMeetings.sourceSlug, feedMeetings.day],
          set: { ...row, seenAt, archivedAt: null },
        });
    }

    await tx
      .update(feedMeetings)
      .set({ archivedAt: seenAt })
      .where(
        and(
          eq(feedMeetings.feedId, feedId),
          lt(feedMeetings.seenAt, seenAt),
          isNull(feedMeetings.archivedAt),
        ),
      );

    await recomputeMeetings([...new Set([...meetingByKey.values()])], tx);
  });
}
```

(`findMatchingMeeting` stays module-private, since only `applyFeedSnapshot` uses it. Insert rows one at a time, because a first sync of about 1,000 rows is well within the budget. If a later profile shows otherwise, batch the upserts.)

- [ ] **Step 4: Run** `pnpm --filter web exec vitest run apply-feed`, then `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit** with the message `feat(meetings): apply feed snapshots with canonical matching and archiving`.

---

### Task 10: Geocoding missing coordinates

**Files:**

- Create: `apps/web/src/server/meetings/geocode.ts`
- Modify: `apps/web/src/env.ts` (add `CENSUS_GEOCODER_URL`), `apps/web/src/server/feeds/fetch-feed.ts` (export `USER_AGENT`)
- Test: `apps/web/test/geocode.test.ts`

**Interfaces:**

- Consumes: `HostThrottle`, `USER_AGENT` (Task 6), `recomputeMeetings` (Task 8) and `startServer` (Task 6).
- Produces:
  - `parseCensusResponse(json: unknown): { latitude: number; longitude: number } | null`.
  - `geocodePendingAddresses(throttle: HostThrottle, deadline: number): Promise<number>`, which geocodes up to 100 addresses of active sources that have no coordinates and no stored result. It stores `matched` or `no_match`, never stores network errors so they're retried next run, recomputes the affected meetings, and returns how many addresses it stored.
  - The endpoint is `readEnv("CENSUS_GEOCODER_URL") ?? "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"`, a real setting that tests point at a local server.

- [ ] **Step 1: Failing test.** Create `apps/web/test/geocode.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { addressGeocodes, meetings } from "@/db/schema";
import { createHostThrottle } from "@/server/feeds/throttle";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";
import { geocodePendingAddresses, parseCensusResponse } from "@/server/meetings/geocode";

import { resetDb } from "./db";
import { feedMeeting, seedFeed } from "./feed-fixtures";
import { startServer } from "./http-server";

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => pool.end());

const matched = {
  result: {
    addressMatches: [
      { matchedAddress: "1 MAIN ST, NASHVILLE, TN, 37203", coordinates: { x: -86.781, y: 36.162 } },
    ],
  },
};
const noMatch = { result: { addressMatches: [] } };

describe("parseCensusResponse", () => {
  it("reads x as longitude and y as latitude", () => {
    expect(parseCensusResponse(matched)).toEqual({ latitude: 36.162, longitude: -86.781 });
  });

  it.each([noMatch, {}, null, { result: { addressMatches: [{ coordinates: { x: "a", y: 1 } }] } }])(
    "finds nothing in %j",
    (json) => {
      expect(parseCensusResponse(json)).toBeNull();
    },
  );
});

describe("geocodePendingAddresses", () => {
  it("stores results, fills the meeting's coordinates and never asks twice", async () => {
    const server = await startServer((path) => ({
      status: 200,
      body: JSON.stringify(path.includes("Nowhere") ? noMatch : matched),
    }));
    vi.stubEnv("CENSUS_GEOCODER_URL", `${server.baseUrl}/geocode`);
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [
      feedMeeting({ latitude: null, longitude: null }),
      feedMeeting({
        sourceSlug: "b",
        formattedAddress: "9 Nowhere Rd",
        addressKey: "9 nowhere rd",
        latitude: null,
        longitude: null,
      }),
    ]);

    expect(await geocodePendingAddresses(createHostThrottle(), Date.now() + 60_000)).toBe(2);
    expect(await geocodePendingAddresses(createHostThrottle(), Date.now() + 60_000)).toBe(0);
    await server.close();

    expect(
      await db
        .select({ key: addressGeocodes.addressKey, status: addressGeocodes.status })
        .from(addressGeocodes)
        .orderBy(addressGeocodes.addressKey),
    ).toEqual([
      { key: "1 main st nashville tn 37203", status: "matched" },
      { key: "9 nowhere rd", status: "no_match" },
    ]);
    const [located] = await db.select().from(meetings).where(eq(meetings.latitude, 36.162));
    expect(located).toMatchObject({ longitude: -86.781, timezone: "America/Chicago" });
    expect(server.requests[0]?.path).toContain("benchmark=Public_AR_Current");
  });

  it("stores nothing when the geocoder is unreachable, so the next run retries", async () => {
    vi.stubEnv("CENSUS_GEOCODER_URL", "http://127.0.0.1:9/geocode");
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting({ latitude: null, longitude: null })]);
    expect(await geocodePendingAddresses(createHostThrottle(), Date.now() + 60_000)).toBe(0);
    expect(await db.select().from(addressGeocodes)).toEqual([]);
  });

  it("does nothing once the deadline has passed", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting({ latitude: null, longitude: null })]);
    expect(await geocodePendingAddresses(createHostThrottle(), Date.now() - 1)).toBe(0);
  });
});
```

(The in-person fixture has no timezone set in this test; it takes `America/Chicago` from `feedMeeting`'s default, and the time-zone lookup itself is covered in Task 8.)

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run geocode`. Expected: FAIL (the module is missing).

- [ ] **Step 3: Implement.** Add `"CENSUS_GEOCODER_URL"` to `EnvName` in `src/env.ts`, and make `USER_AGENT` exported in `fetch-feed.ts`. Then create `apps/web/src/server/meetings/geocode.ts`:

```ts
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { addressGeocodes, feedMeetings } from "@/db/schema";
import { readEnv } from "@/env";
import { USER_AGENT } from "@/server/feeds/fetch-feed";
import type { HostThrottle } from "@/server/feeds/throttle";
import { recomputeMeetings } from "@/server/meetings/recompute";

const DEFAULT_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const BATCH_SIZE = 100;
const TIMEOUT_MS = 15_000;

export function parseCensusResponse(json: unknown): { latitude: number; longitude: number } | null {
  if (typeof json !== "object" || json === null) return null;
  const matches: unknown = (json as { result?: { addressMatches?: unknown } }).result?.addressMatches;
  if (!Array.isArray(matches)) return null;
  const coordinates: unknown = (matches[0] as { coordinates?: unknown } | undefined)?.coordinates;
  if (typeof coordinates !== "object" || coordinates === null) return null;
  const { x, y } = coordinates as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" ? { latitude: y, longitude: x } : null;
}

async function geocode(
  address: string,
  throttle: HostThrottle,
): Promise<{ latitude: number; longitude: number } | null | "error"> {
  const url = new URL(readEnv("CENSUS_GEOCODER_URL") ?? DEFAULT_GEOCODER_URL);
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  await throttle.wait(url.host);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return "error";
    return parseCensusResponse(await response.json());
  } catch {
    return "error";
  }
}

// Spec §3: geocode meetings missing coordinates after sync. Results are keyed by normalized address and kept.
export async function geocodePendingAddresses(throttle: HostThrottle, deadline: number): Promise<number> {
  if (Date.now() >= deadline) return 0;
  const pending = await db
    .selectDistinctOn([feedMeetings.addressKey], {
      addressKey: feedMeetings.addressKey,
      address: feedMeetings.formattedAddress,
    })
    .from(feedMeetings)
    .where(
      and(
        isNull(feedMeetings.archivedAt),
        isNull(feedMeetings.latitude),
        isNotNull(feedMeetings.addressKey),
        isNotNull(feedMeetings.formattedAddress),
        sql`not exists (select 1 from address_geocodes g where g.address_key = ${feedMeetings.addressKey})`,
      ),
    )
    .limit(BATCH_SIZE);

  const stored: string[] = [];
  for (const { addressKey, address } of pending) {
    if (Date.now() >= deadline) break;
    if (addressKey === null || address === null) continue;
    const result = await geocode(address, throttle);
    if (result === "error") continue;
    await db
      .insert(addressGeocodes)
      .values(
        result === null ? { addressKey, status: "no_match" } : { addressKey, status: "matched", ...result },
      );
    stored.push(addressKey);
  }

  if (stored.length > 0) {
    const affected = await db
      .selectDistinct({ id: feedMeetings.meetingId })
      .from(feedMeetings)
      .where(inArray(feedMeetings.addressKey, stored));
    await recomputeMeetings(affected.map((row) => row.id));
  }
  return stored.length;
}
```

(The `as` casts follow `typeof` checks, which the standards allow. `eq` isn't used, so remove it if lint says so.)

- [ ] **Step 4: Run** `pnpm --filter web exec vitest run geocode`, then `pnpm check`. Expected: PASS. Port 9 (the discard service) is used because nothing listens there. If it's open on the machine, pick another closed port.

- [ ] **Step 5: Commit** with the message `feat(meetings): geocode missing coordinates with the Census geocoder`.

---

### Task 11: The sync run and its cron route

**Files:**

- Create: `apps/web/src/server/sync/run-sync.ts`, `apps/web/src/lib/api/cron-auth.ts`, `apps/web/src/app/api/cron/sync-feeds/route.ts`
- Modify: `apps/web/src/env.ts` (add `CRON_SECRET`), `apps/web/vercel.ts` (add crons), `apps/web/.env.example`
- Test: `apps/web/test/run-sync.test.ts`, `apps/web/test/sync-route.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 5–10.
- Produces:
  - `SyncSummary`, a zod schema defined next to the runner (cron output is internal, not a mobile contract). Shape: `{ status: "done" | "locked"; synced: number; unchanged: number; failed: number; geocoded: number }`.
  - `runSync(budgetMs: number): Promise<SyncSummary>`.
  - `assertCronRequest(req: Request): void`, which throws `ApiError("unauthorized")`.
  - The route `GET /api/cron/sync-feeds` (`maxDuration = 300`).
  - `vercel.ts`: `crons: [{ path: "/api/cron/sync-feeds", schedule: "*/15 * * * *" }]`.

**How the run works:**

1. Take a Postgres advisory lock, or return `locked`.
2. Archive sources of opted-out feeds.
3. Pick the due feeds: not opted out, never succeeded or last succeeded more than 12 h ago, and not attempted in the last hour. Oldest success first.
4. For each feed, while `Date.now() < deadline`:
   - record the attempt, then fetch the feed;
   - `not_modified` counts as a success, with no changes;
   - `error` records `last_error`;
   - `ok` normalizes the feed (a `FeedFormatError` becomes an error);
   - **shrink guard:** if the previous count was 20 or more and the new count is below half of it, record an error and apply nothing;
   - otherwise apply the snapshot and record success, count, `etag` and `last_modified`.
5. Geocode with the time that's left.
6. Release the lock.

- [ ] **Step 1: Failing tests.** Create `apps/web/test/run-sync.test.ts`:

```ts
import { eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { feedMeetings, feeds, meetings } from "@/db/schema";
import { upsertFeed } from "@/db/upsert-feed";
import { runSync } from "@/server/sync/run-sync";

import { resetDb } from "./db";
import { startServer } from "./http-server";

const servers: { close(): Promise<void> }[] = [];
beforeEach(resetDb);
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
afterAll(() => pool.end());

function meetingJson(count: number) {
  return JSON.stringify(
    Array.from({ length: count }, (_, i) => ({
      slug: `m${String(i)}`,
      name: `M${String(i)}`,
      day: i % 7,
      time: "19:00",
      formatted_address: `${String(i)} Main St, Nashville, TN`,
      latitude: 36 + i / 100,
      longitude: -86.78,
      timezone: "America/Chicago",
    })),
  );
}

async function feedServing(
  slug: string,
  reply: () => { status: number; body?: string; headers?: Record<string, string> },
) {
  const server = await startServer(reply);
  servers.push(server);
  const id = await upsertFeed({
    slug,
    name: slug,
    entityType: "intergroup",
    state: "TN",
    url: `${server.baseUrl}/${slug}`,
  });
  return { id, server };
}

async function feed(id: number) {
  const [row] = await db.select().from(feeds).where(eq(feeds.id, id));
  return row;
}

describe("runSync", () => {
  it("syncs due feeds and keeps going when one fails", async () => {
    const good = await feedServing("good", () => ({ status: 200, body: meetingJson(3) }));
    const bad = await feedServing("bad", () => ({ status: 500 }));
    expect(await runSync(60_000)).toEqual({
      status: "done",
      synced: 1,
      unchanged: 0,
      failed: 1,
      geocoded: 0,
    });
    expect(await feed(good.id)).toMatchObject({ meetingCount: 3, lastError: null });
    expect(await feed(bad.id)).toMatchObject({ lastError: "HTTP 500", lastSuccessAt: null });
    expect(await db.select().from(meetings).where(isNull(meetings.archivedAt))).toHaveLength(3);
  });

  it("records a restricted feed and doesn't retry it within the hour", async () => {
    const restricted = await feedServing("restricted", () => ({ status: 403 }));
    await runSync(60_000);
    expect((await feed(restricted.id))?.lastError).toBe("restricted (HTTP 403)");
    expect(await runSync(60_000)).toMatchObject({ synced: 0, failed: 0 });
    expect(restricted.server.requests).toHaveLength(1);
  });

  it("doesn't sync a feed that succeeded within 12 hours", async () => {
    const recent = await feedServing("recent", () => ({ status: 200, body: meetingJson(1) }));
    await db
      .update(feeds)
      .set({
        lastSuccessAt: new Date(Date.now() - 11 * 3600_000),
        lastAttemptAt: new Date(Date.now() - 11 * 3600_000),
      })
      .where(eq(feeds.id, recent.id));
    expect(await runSync(60_000)).toMatchObject({ synced: 0 });
    expect(recent.server.requests).toHaveLength(0);
  });

  it("treats an unchanged feed as a success and keeps its meetings", async () => {
    let calls = 0;
    const cached = await feedServing("cached", () =>
      calls++ === 0 ? { status: 200, body: meetingJson(2), headers: { ETag: '"v1"' } } : { status: 304 },
    );
    await runSync(60_000);
    await db
      .update(feeds)
      .set({ lastSuccessAt: new Date(0), lastAttemptAt: new Date(0) })
      .where(eq(feeds.id, cached.id));
    expect(await runSync(60_000)).toMatchObject({ unchanged: 1 });
    expect(cached.server.requests[1]?.headers["if-none-match"]).toBe('"v1"');
    expect(await db.select().from(meetings).where(isNull(meetings.archivedAt))).toHaveLength(2);
  });

  it("does not apply a feed that shrank by more than half", async () => {
    let body = meetingJson(40);
    const shrinking = await feedServing("shrinking", () => ({ status: 200, body }));
    await runSync(60_000);
    body = meetingJson(10);
    await db
      .update(feeds)
      .set({ lastSuccessAt: new Date(0), lastAttemptAt: new Date(0) })
      .where(eq(feeds.id, shrinking.id));
    expect(await runSync(60_000)).toMatchObject({ failed: 1 });
    expect((await feed(shrinking.id))?.lastError).toBe("meeting count dropped from 40 to 10; not applied");
    expect(await db.select().from(meetings).where(isNull(meetings.archivedAt))).toHaveLength(40);
  });

  it("records a feed that isn't a meeting array", async () => {
    const odd = await feedServing("odd", () => ({ status: 200, body: '{"meetings":[]}' }));
    await runSync(60_000);
    expect((await feed(odd.id))?.lastError).toBe("Feed is not a JSON array of meetings");
  });

  it("stops starting feeds when the budget is spent", async () => {
    await feedServing("late", () => ({ status: 200, body: meetingJson(1) }));
    expect(await runSync(0)).toMatchObject({ status: "done", synced: 0 });
  });

  it("archives the meetings of an opted-out feed", async () => {
    const leaving = await feedServing("leaving", () => ({ status: 200, body: meetingJson(2) }));
    await runSync(60_000);
    await db.update(feeds).set({ optedOut: true }).where(eq(feeds.id, leaving.id));
    await runSync(60_000);
    expect(await db.select().from(meetings).where(isNull(meetings.archivedAt))).toHaveLength(0);
    expect(await db.select().from(feedMeetings).where(isNull(feedMeetings.archivedAt))).toHaveLength(0);
  });

  it("lets only one run happen at a time", async () => {
    await feedServing("slow", () => ({ status: 200, body: meetingJson(1) }));
    const results = await Promise.all([runSync(60_000), runSync(60_000)]);
    expect(results.map((result) => result.status).sort()).toEqual(["done", "locked"]);
  });
});
```

Create `apps/web/test/sync-route.test.ts`:

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/cron/sync-feeds/route";
import { pool } from "@/db/client";

import { resetDb } from "./db";

beforeEach(resetDb);
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(() => pool.end());

function call(authorization?: string) {
  return GET(
    new Request("http://test/api/cron/sync-feeds", {
      headers: authorization === undefined ? {} : { Authorization: authorization },
    }),
  );
}

describe("GET /api/cron/sync-feeds", () => {
  it.each([undefined, "Bearer wrong-secret-value", "wrong", "Bearer "])(
    "refuses %j",
    async (authorization) => {
      vi.stubEnv("CRON_SECRET", "a-long-random-cron-secret");
      const res = await call(authorization);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "unauthorized" } });
    },
  );

  it("refuses every request when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    expect((await call("Bearer ")).status).toBe(401);
  });

  it("runs the sync for Vercel Cron", async () => {
    vi.stubEnv("CRON_SECRET", "a-long-random-cron-secret");
    const res = await call("Bearer a-long-random-cron-secret");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "done", synced: 0, unchanged: 0, failed: 0, geocoded: 0 });
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run run-sync sync-route`. Expected: FAIL (the modules are missing).

- [ ] **Step 3: Implement.** Add `"CRON_SECRET"` to `EnvName`. Create `apps/web/src/lib/api/cron-auth.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";

import { readEnv } from "@/env";
import { ApiError } from "@/lib/api/respond";

const digest = (value: string) => createHash("sha256").update(value).digest();

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without a configured secret, nothing gets in.
export function assertCronRequest(req: Request): void {
  const secret = readEnv("CRON_SECRET");
  const header = req.headers.get("authorization") ?? "";
  if (secret === undefined || !timingSafeEqual(digest(header), digest(`Bearer ${secret}`))) {
    throw new ApiError("unauthorized");
  }
}
```

Create `apps/web/src/server/sync/run-sync.ts`:

```ts
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db, pool } from "@/db/client";
import { feedMeetings, feeds } from "@/db/schema";
import { fetchFeed } from "@/server/feeds/fetch-feed";
import { FeedFormatError, normalizeFeed } from "@/server/feeds/normalize";
import { createHostThrottle, type HostThrottle } from "@/server/feeds/throttle";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";
import { geocodePendingAddresses } from "@/server/meetings/geocode";
import { recomputeMeetings } from "@/server/meetings/recompute";

export const SyncSummary = z.object({
  status: z.enum(["done", "locked"]),
  synced: z.number().int(),
  unchanged: z.number().int(),
  failed: z.number().int(),
  geocoded: z.number().int(),
});
export type SyncSummary = z.infer<typeof SyncSummary>;

const LOCK_KEY = 7_202_609; // arbitrary constant naming the feed-sync advisory lock
const SUCCESS_INTERVAL = sql`interval '12 hours'`;
const RETRY_INTERVAL = sql`interval '1 hour'`;
const SHRINK_GUARD_MINIMUM = 20;

type Feed = typeof feeds.$inferSelect;
type Outcome = "synced" | "unchanged" | "failed";

async function recordFailure(feed: Feed, message: string): Promise<Outcome> {
  await db.update(feeds).set({ lastError: message }).where(eq(feeds.id, feed.id));
  return "failed";
}

async function syncFeed(feed: Feed, throttle: HostThrottle): Promise<Outcome> {
  await db.update(feeds).set({ lastAttemptAt: new Date() }).where(eq(feeds.id, feed.id));
  const fetched = await fetchFeed(feed.url, { etag: feed.etag, lastModified: feed.lastModified }, throttle);
  if (fetched.kind === "error") return recordFailure(feed, fetched.message);
  if (fetched.kind === "not_modified") {
    await db.update(feeds).set({ lastSuccessAt: new Date(), lastError: null }).where(eq(feeds.id, feed.id));
    return "unchanged";
  }

  let rows;
  try {
    rows = normalizeFeed(fetched.body).meetings;
  } catch (error) {
    if (error instanceof FeedFormatError) return recordFailure(feed, error.message);
    throw error;
  }
  // Spec §3: a feed hiccup must not archive meetings (and their tag history) wholesale.
  const previous = feed.meetingCount ?? 0;
  if (previous >= SHRINK_GUARD_MINIMUM && rows.length < previous / 2) {
    return recordFailure(
      feed,
      `meeting count dropped from ${String(previous)} to ${String(rows.length)}; not applied`,
    );
  }

  await applyFeedSnapshot(feed.id, rows);
  await db
    .update(feeds)
    .set({
      lastSuccessAt: new Date(),
      lastError: null,
      meetingCount: rows.length,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
    })
    .where(eq(feeds.id, feed.id));
  return "synced";
}

async function archiveOptedOutFeeds(): Promise<void> {
  const archived = await db
    .update(feedMeetings)
    .set({ archivedAt: new Date() })
    .where(
      and(
        isNull(feedMeetings.archivedAt),
        inArray(feedMeetings.feedId, db.select({ id: feeds.id }).from(feeds).where(eq(feeds.optedOut, true))),
      ),
    )
    .returning({ meetingId: feedMeetings.meetingId });
  await recomputeMeetings([...new Set(archived.map((row) => row.meetingId))]);
}

async function dueFeeds(): Promise<Feed[]> {
  return db
    .select()
    .from(feeds)
    .where(
      and(
        eq(feeds.optedOut, false),
        or(isNull(feeds.lastSuccessAt), lt(feeds.lastSuccessAt, sql`now() - ${SUCCESS_INTERVAL}`)),
        or(isNull(feeds.lastAttemptAt), lt(feeds.lastAttemptAt, sql`now() - ${RETRY_INTERVAL}`)),
      ),
    )
    .orderBy(sql`${feeds.lastSuccessAt} nulls first`, feeds.id);
}

// Spec §3: stalest feeds first, stop starting new ones when the budget is spent, one failure never stops the rest.
export async function runSync(budgetMs: number): Promise<SyncSummary> {
  const deadline = Date.now() + budgetMs;
  const lockClient = await pool.connect();
  try {
    const { rows } = await lockClient.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [LOCK_KEY],
    );
    if (rows[0]?.locked !== true)
      return { status: "locked", synced: 0, unchanged: 0, failed: 0, geocoded: 0 };
    try {
      await archiveOptedOutFeeds();
      const counts: Record<Outcome, number> = { synced: 0, unchanged: 0, failed: 0 };
      const throttle = createHostThrottle();
      for (const feed of await dueFeeds()) {
        if (Date.now() >= deadline) break;
        let outcome: Outcome;
        try {
          outcome = await syncFeed(feed, throttle);
        } catch (error) {
          console.error(
            `[sync] feed ${String(feed.id)} failed:`,
            error instanceof Error ? error.name : "unknown error",
          );
          outcome = await recordFailure(feed, "sync failed; see logs");
        }
        counts[outcome] += 1;
      }
      const geocoded = await geocodePendingAddresses(throttle, deadline);
      return { status: "done", ...counts, geocoded };
    } finally {
      await lockClient.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    lockClient.release();
  }
}
```

(In the unexpected-error branch, only the error's name is logged, following the same rule as `withErrors`, because a database error's text can quote values. If a richer log is needed, reuse `withErrors`'s `describeError` by exporting it from `respond.ts` and adding it to the standards table as the one way to describe errors.)

Create `apps/web/src/app/api/cron/sync-feeds/route.ts`:

```ts
import { assertCronRequest } from "@/lib/api/cron-auth";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { runSync, SyncSummary } from "@/server/sync/run-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Stop starting new feeds after ~240 s so the run always finishes inside maxDuration (spec §3).
const SYNC_BUDGET_MS = 240_000;

export const GET = withErrors(async (req: Request) => {
  assertCronRequest(req);
  return jsonResponse(SyncSummary, await runSync(SYNC_BUDGET_MS), "none");
});
```

In `apps/web/vercel.ts`, add `crons: [{ path: "/api/cron/sync-feeds", schedule: "*/15 * * * *" }]` with the comment `// Every 15 minutes (spec §3). Needs Vercel Pro: Hobby allows only daily crons.` Add `CRON_SECRET=` to `.env.example`, left empty so local cron calls stay refused unless you set it.

In `docs/standards.md`, change the "API contract" row to: "A zod schema in `packages/shared` for anything the mobile app reads. Internal endpoints (cron) define their response schema next to the server module that produces it (e.g. `SyncSummary`)."

- [ ] **Step 4: Run** `pnpm --filter web exec vitest run run-sync sync-route`, then `pnpm check`. Expected: PASS. The lock test depends on both calls reaching `pg_try_advisory_lock` before either releases it. If it proves flaky, delay one feed's reply by 200 ms in the server handler, which keeps the first run inside the lock.

- [ ] **Step 5: Commit** with the message `feat(sync): sync due feeds under a lock with a budget, shrink guard and cron route`.

---

### Task 12: The meeting summary query and `GET /api/v1/meetings/:id`

**Files:**

- Create: `apps/web/src/server/meetings/summary.ts`, `apps/web/src/server/meetings/detail.ts`, `apps/web/src/app/api/v1/meetings/[id]/route.ts`
- Modify: `apps/web/src/lib/api/respond.ts` (add the `meetingDetail` cache policy)
- Test: `apps/web/test/meeting-detail-route.test.ts`

**Interfaces:**

- Produces:
  - `summaryColumns`, the select map from `meetings` joined to its primary `feed_meetings` row onto `MeetingSummary` fields.
  - `fromMeetingsWithPrimarySource()`, which returns the base query builder. Tasks 13 and 14 use both.
  - `getMeeting(id: string): Promise<MeetingSummary | undefined>`.
  - The route `GET /api/v1/meetings/:id` with cache policy `meetingDetail` (`public, s-maxage=300, stale-while-revalidate=600`). It returns 404 `meeting_not_found` for an unknown or archived meeting, and 400 `invalid_request` for an id that isn't a UUID.

- [ ] **Step 1: Failing test.** Create `apps/web/test/meeting-detail-route.test.ts`:

```ts
import { MeetingDetailResponse } from "@mymeetingapp/shared";
import { isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/v1/meetings/[id]/route";
import { db, pool } from "@/db/client";
import { feedMeetings, meetings } from "@/db/schema";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";

import { resetDb } from "./db";
import { feedMeeting, seedFeed } from "./feed-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

function get(id: string) {
  return GET(new Request(`http://test/api/v1/meetings/${id}`), { params: Promise.resolve({ id }) });
}

async function onlyMeetingId() {
  const [row] = await db.select({ id: meetings.id }).from(meetings).where(isNull(meetings.archivedAt));
  return row?.id ?? "";
}

describe("GET /api/v1/meetings/:id", () => {
  it("returns the meeting from its primary source, cacheable for five minutes", async () => {
    await applyFeedSnapshot(await seedFeed("a"), [
      feedMeeting({ notes: "Use the side door", types: ["O", "BE"] }),
    ]);
    const id = await onlyMeetingId();
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=300, stale-while-revalidate=600");
    expect(MeetingDetailResponse.parse(await res.json()).meeting).toEqual({
      id,
      name: "Nooners",
      day: 1,
      time: "12:00",
      endTime: null,
      timezone: "America/Chicago",
      types: ["O", "BE"],
      attendance: "in_person",
      locationName: "St. Luke's",
      formattedAddress: "1 Main St, Nashville, TN 37203, USA",
      latitude: 36.17,
      longitude: -86.78,
      locationNotes: null,
      notes: "Use the side door",
      groupName: null,
      conferenceUrl: null,
      conferenceUrlNotes: null,
      conferencePhone: null,
      conferencePhoneNotes: null,
      sourceUrl: null,
    });
  });

  it("returns meeting_not_found for an archived meeting", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting()]);
    const id = await onlyMeetingId();
    await db.update(feedMeetings).set({ archivedAt: new Date() });
    await applyFeedSnapshot(feedId, []);
    const res = await get(id);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "meeting_not_found" } });
  });

  it("returns meeting_not_found for an unknown id and invalid_request for a malformed one", async () => {
    expect((await get("0f8fad5b-d9cb-469f-a165-70867728950e")).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run meeting-detail-route`. Expected: FAIL (the route is missing).

- [ ] **Step 3: Implement** `apps/web/src/server/meetings/summary.ts`:

```ts
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { feedMeetings, meetings } from "@/db/schema";

// Identity, location and time zone come from the canonical meeting; everything shown comes from its primary source.
export const summaryColumns = {
  id: meetings.id,
  name: feedMeetings.name,
  day: meetings.day,
  time: meetings.time,
  endTime: feedMeetings.endTime,
  timezone: meetings.timezone,
  types: feedMeetings.types,
  attendance: feedMeetings.attendance,
  locationName: feedMeetings.locationName,
  formattedAddress: feedMeetings.formattedAddress,
  latitude: meetings.latitude,
  longitude: meetings.longitude,
  locationNotes: feedMeetings.locationNotes,
  notes: feedMeetings.notes,
  groupName: feedMeetings.groupName,
  conferenceUrl: feedMeetings.conferenceUrl,
  conferenceUrlNotes: feedMeetings.conferenceUrlNotes,
  conferencePhone: feedMeetings.conferencePhone,
  conferencePhoneNotes: feedMeetings.conferencePhoneNotes,
  sourceUrl: feedMeetings.sourceUrl,
};

export function fromMeetingsWithPrimarySource<Extra extends Record<string, unknown>>(extra: Extra) {
  return db
    .select({ ...summaryColumns, ...extra })
    .from(meetings)
    .innerJoin(feedMeetings, eq(feedMeetings.id, meetings.primaryFeedMeetingId));
}
```

(If Drizzle's select typing rejects a generic `extra`, drop it here, and have `search.ts` build its own `db.select({ ...summaryColumns, distanceKm }).from(...).innerJoin(...)`, keeping the join in a `primarySourceJoin` constant so it's written once.)

`apps/web/src/server/meetings/detail.ts`:

```ts
import type { MeetingSummary } from "@mymeetingapp/shared";
import { and, eq, isNull } from "drizzle-orm";

import { meetings } from "@/db/schema";
import { fromMeetingsWithPrimarySource } from "@/server/meetings/summary";

export async function getMeeting(id: string): Promise<MeetingSummary | undefined> {
  const [row] = await fromMeetingsWithPrimarySource({}).where(
    and(eq(meetings.id, id), isNull(meetings.archivedAt)),
  );
  return row;
}
```

(If the row type isn't assignable to `MeetingSummary`, because of `types: string[]` or the `attendance` string, return the row and let `jsonResponse`'s parse enforce the contract. Type `getMeeting` as returning the inferred row type instead of `MeetingSummary`.)

`apps/web/src/app/api/v1/meetings/[id]/route.ts`:

```ts
import { MeetingDetailResponse } from "@mymeetingapp/shared";
import { z } from "zod";

import { parseInput } from "@/lib/api/request";
import { ApiError, jsonResponse, withErrors } from "@/lib/api/respond";
import { getMeeting } from "@/server/meetings/detail";

export const dynamic = "force-dynamic";

const Params = z.object({ id: z.uuid() });

export const GET = withErrors(async (_req: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = parseInput(Params, await context.params);
  const meeting = await getMeeting(id);
  if (meeting === undefined) throw new ApiError("meeting_not_found");
  return jsonResponse(MeetingDetailResponse, { meeting }, "meetingDetail");
});
```

Add `meetingDetail: "public, s-maxage=300, stale-while-revalidate=600"` to `CACHE_POLICIES`. Move `zod` from devDependencies to dependencies in `apps/web/package.json` (`pnpm --filter web remove zod && pnpm --filter web add zod`), since route files now use it at runtime.

- [ ] **Step 4: Run** `pnpm --filter web exec vitest run meeting-detail-route`, then `pnpm check`, then `DATABASE_URL= pnpm --filter web build`. Expected: PASS, with `/api/v1/meetings/[id]` listed as dynamic.

- [ ] **Step 5: Commit** with the message `feat(api): add GET /api/v1/meetings/:id`.

---

### Task 13: `POST /api/v1/meetings/search`

**Files:**

- Create: `apps/web/src/server/meetings/search.ts`, `apps/web/src/app/api/v1/meetings/search/route.ts`
- Test: `apps/web/test/search-route.test.ts`

**Interfaces:**

- Produces: `searchMeetings({ lat, lng, radiusKm }): Promise<MeetingSearchResponse["meetings"]>`, which returns in-person and hybrid meetings within the radius, excludes archived ones, orders them nearest first, and caps the list at 1000. It adds a `distanceKm` rounded to 0.1.
- The route is `POST`, with no caching: coordinates never appear in a URL or cache key (spec §2).

- [ ] **Step 1: Failing test.** Create `apps/web/test/search-route.test.ts`:

```ts
import { MeetingSearchResponse } from "@mymeetingapp/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { format } from "node:util";

import { POST } from "@/app/api/v1/meetings/search/route";
import { pool } from "@/db/client";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";

import { resetDb } from "./db";
import { feedMeeting, seedFeed } from "./feed-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

function search(body: unknown) {
  return POST(
    new Request("http://test/api/v1/meetings/search", { method: "POST", body: JSON.stringify(body) }),
  );
}

async function seedNashville() {
  const feedId = await seedFeed("a");
  await applyFeedSnapshot(feedId, [
    feedMeeting({ sourceSlug: "near", addressKey: "near", latitude: 36.17, longitude: -86.78 }),
    feedMeeting({
      sourceSlug: "hybrid",
      addressKey: "hybrid",
      latitude: 36.3,
      longitude: -86.78,
      attendance: "hybrid",
      conferenceUrl: "https://zoom.us/j/9",
    }),
    feedMeeting({ sourceSlug: "far", addressKey: "far", latitude: 37.5, longitude: -86.78 }),
    feedMeeting({
      sourceSlug: "online",
      attendance: "online",
      formattedAddress: null,
      addressKey: null,
      latitude: null,
      longitude: null,
      conferenceUrl: "https://zoom.us/j/1",
    }),
  ]);
}

describe("POST /api/v1/meetings/search", () => {
  it("returns in-person and hybrid meetings in the radius, nearest first, never cached", async () => {
    await seedNashville();
    const res = await search({ lat: 36.16, lng: -86.78, radiusKm: 25 });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { meetings } = MeetingSearchResponse.parse(await res.json());
    expect(meetings.map((m) => [m.attendance, m.distanceKm > 0])).toEqual([
      ["in_person", true],
      ["hybrid", true],
    ]);
    expect(meetings[0]?.distanceKm).toBe(1.1);
    expect(meetings[1]?.distanceKm).toBeCloseTo(15.5, 0);
  });

  it("leaves out archived meetings", async () => {
    const feedId = await seedFeed("a");
    await applyFeedSnapshot(feedId, [feedMeeting()]);
    await applyFeedSnapshot(feedId, []);
    const { meetings } = MeetingSearchResponse.parse(
      await (await search({ lat: 36.16, lng: -86.78, radiusKm: 25 })).json(),
    );
    expect(meetings).toEqual([]);
  });

  it.each([
    { lat: 36.1627, lng: -86.7816, radiusKm: 25 },
    { lat: 36.16, lng: -86.78 },
    { lat: "36.16", lng: -86.78, radiusKm: 25 },
  ])("rejects %j without logging it", async (body) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await search(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
    expect(log.mock.calls.map((args) => format(...args)).join("\n")).not.toContain("36.16");
    log.mockRestore();
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run search-route`. Expected: FAIL (the route is missing).

- [ ] **Step 3: Implement** `apps/web/src/server/meetings/search.ts`:

```ts
import type { MeetingSearchRequest } from "@mymeetingapp/shared";
import { and, inArray, isNull, sql } from "drizzle-orm";

import { feedMeetings, meetingLocation, meetings } from "@/db/schema";
import { fromMeetingsWithPrimarySource } from "@/server/meetings/summary";

const MAX_RESULTS = 1000;

export async function searchMeetings({ lat, lng, radiusKm }: MeetingSearchRequest) {
  const center = sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;
  return fromMeetingsWithPrimarySource({
    distanceKm: sql<number>`round((ST_Distance(${meetingLocation}, ${center}) / 1000)::numeric, 1)::float8`,
  })
    .where(
      and(
        isNull(meetings.archivedAt),
        inArray(feedMeetings.attendance, ["in_person", "hybrid"]),
        sql`ST_DWithin(${meetingLocation}, ${center}, ${radiusKm * 1000})`,
      ),
    )
    .orderBy(sql`${meetingLocation} <-> ${center}`)
    .limit(MAX_RESULTS);
}
```

`apps/web/src/app/api/v1/meetings/search/route.ts`:

```ts
import { MeetingSearchRequest, MeetingSearchResponse } from "@mymeetingapp/shared";

import { readJsonBody } from "@/lib/api/request";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { searchMeetings } from "@/server/meetings/search";

export const dynamic = "force-dynamic";

// Spec §2: coordinates arrive rounded, only in this POST body, and are never stored, logged or cached.
export const POST = withErrors(async (req: Request) => {
  const request = await readJsonBody(req, MeetingSearchRequest);
  return jsonResponse(MeetingSearchResponse, { meetings: await searchMeetings(request) }, "none");
});
```

- [ ] **Step 4: Run** `pnpm --filter web exec vitest run search-route`, then `pnpm check`. Expected: PASS. If the 1.1 km literal is off by 0.1 because of spheroid distance, check it by hand with `select ST_Distance('POINT(-86.78 36.16)'::geography, 'POINT(-86.78 36.17)'::geography)` in psql, and correct the literal to the value PostGIS reports, with a comment giving the reason.

- [ ] **Step 5: Commit** with the message `feat(api): add POST /api/v1/meetings/search`.

---

### Task 14: `GET /api/v1/meetings/online?day=`

**Files:**

- Create: `apps/web/src/server/meetings/online.ts`, `apps/web/src/app/api/v1/meetings/online/route.ts`
- Modify: `apps/web/src/lib/api/respond.ts` (add the `onlineMeetings` cache policy)
- Test: `apps/web/test/online-route.test.ts`

**Interfaces:**

- Produces: `onlineMeetings(day: number)`, which returns online and hybrid meetings with a conference URL or phone on that day, excludes archived ones, and orders them by time then name. The cache policy `onlineMeetings` is `public, s-maxage=900, stale-while-revalidate=3600`.

- [ ] **Step 1: Failing test.** Create `apps/web/test/online-route.test.ts`:

```ts
import { OnlineMeetingsResponse } from "@mymeetingapp/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/v1/meetings/online/route";
import { pool } from "@/db/client";
import { applyFeedSnapshot } from "@/server/meetings/apply-feed";

import { resetDb } from "./db";
import { feedMeeting, seedFeed } from "./feed-fixtures";

beforeEach(resetDb);
afterAll(() => pool.end());

const online = {
  attendance: "online",
  formattedAddress: null,
  addressKey: null,
  latitude: null,
  longitude: null,
} as const;

function get(query: string) {
  return GET(new Request(`http://test/api/v1/meetings/online${query}`));
}

describe("GET /api/v1/meetings/online", () => {
  it("returns that day's online and hybrid meetings by time, cacheable for 15 minutes", async () => {
    await applyFeedSnapshot(await seedFeed("a"), [
      feedMeeting({
        ...online,
        sourceSlug: "late",
        time: "20:00",
        name: "Late",
        conferenceUrl: "https://zoom.us/j/2",
      }),
      feedMeeting({
        ...online,
        sourceSlug: "early",
        time: "07:00",
        name: "Early",
        conferencePhone: "+1 555 0100",
      }),
      feedMeeting({
        sourceSlug: "hybrid",
        time: "12:00",
        name: "Hybrid",
        attendance: "hybrid",
        conferenceUrl: "https://zoom.us/j/3",
      }),
      feedMeeting({ sourceSlug: "in-person", time: "09:00", name: "In person" }),
      feedMeeting({ ...online, sourceSlug: "other-day", day: 2, conferenceUrl: "https://zoom.us/j/4" }),
    ]);
    const res = await get("?day=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=900, stale-while-revalidate=3600");
    expect(OnlineMeetingsResponse.parse(await res.json()).meetings.map((m) => m.name)).toEqual([
      "Early",
      "Hybrid",
      "Late",
    ]);
  });

  it.each(["", "?day=7", "?day=monday"])("rejects %j", async (query) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_request" } });
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter web exec vitest run online-route`. Expected: FAIL (the route is missing).

- [ ] **Step 3: Implement** `apps/web/src/server/meetings/online.ts`:

```ts
import { and, eq, inArray, isNull } from "drizzle-orm";

import { feedMeetings, meetings } from "@/db/schema";
import { fromMeetingsWithPrimarySource } from "@/server/meetings/summary";

// The normalizer only marks a meeting online or hybrid when it has a conference URL or phone.
export async function onlineMeetings(day: number) {
  return fromMeetingsWithPrimarySource({})
    .where(
      and(
        isNull(meetings.archivedAt),
        eq(meetings.day, day),
        inArray(feedMeetings.attendance, ["online", "hybrid"]),
      ),
    )
    .orderBy(meetings.time, feedMeetings.name);
}
```

`apps/web/src/app/api/v1/meetings/online/route.ts`:

```ts
import { OnlineMeetingsQuery, OnlineMeetingsResponse } from "@mymeetingapp/shared";

import { parseInput } from "@/lib/api/request";
import { jsonResponse, withErrors } from "@/lib/api/respond";
import { onlineMeetings } from "@/server/meetings/online";

export const dynamic = "force-dynamic";

// One day at a time keeps nationwide online meetings well under the 4.5 MB response limit.
export const GET = withErrors(async (req: Request) => {
  const { day } = parseInput(OnlineMeetingsQuery, { day: new URL(req.url).searchParams.get("day") });
  return jsonResponse(OnlineMeetingsResponse, { meetings: await onlineMeetings(day) }, "onlineMeetings");
});
```

Add `onlineMeetings: "public, s-maxage=900, stale-while-revalidate=3600"` to `CACHE_POLICIES`.

- [ ] **Step 4: Run** `pnpm check`, then `pnpm knip:production`, then `DATABASE_URL= pnpm --filter web build`. Expected: all PASS. This is the end-of-phase dead-code gate, so every export must have a production consumer.

- [ ] **Step 5: Commit** with the message `feat(api): add GET /api/v1/meetings/online`.

---

### Task 15: Deploying Phase 2 (with the user)

This needs the user's accounts and a plan upgrade, so run it with them.

**Files:**

- Modify: `docs/deploy.md`

- [ ] **Step 1: Prerequisites (the user):**
  - Upgrade the team to **Vercel Pro**. The 15-minute cron fails to deploy on Hobby.
  - Create the mailbox `support@mymeetingapp.com` for the feed User-Agent.
- [ ] **Step 2: Set the cron secret.** Generate it with `openssl rand -hex 32`. Then run `vercel env add CRON_SECRET production` and paste the value, which is never echoed or committed. Add it for Preview too, so the route can be exercised on previews.
- [ ] **Step 3: Record the deployment steps.** Add to `docs/deploy.md`:
  - Phase 2 requires Pro.
  - Set `CRON_SECRET` as above.
  - Add feeds with `vercel env run -e production -- pnpm --filter web db:add-feed …`, moving `.env.local` aside first.
  - Trigger a sync by hand with `vercel curl /api/cron/sync-feeds -- --header "Authorization: Bearer $CRON_SECRET"`.
  - `sslmode` is upgraded to `verify-full` in code, so the integration-managed variables stay as they are.
- [ ] **Step 4: Open the PR and check the preview.** CI must be green, and the preview gets its own Neon branch.
  1. Add one open feed to the preview branch database. `https://aasandiego.org/wp-json/tsml/meetings` was verified open on 2026-09-26.
  2. Trigger the sync on the preview.

  Expected:
  - The sync summary shows `synced: 1`.
  - `POST /api/v1/meetings/search` with `{ "lat": 32.72, "lng": -117.16, "radiusKm": 10 }` returns San Diego meetings nearest first.
  - `GET /api/v1/meetings/online?day=1` returns online meetings.
  - The detail route works for one of the returned ids.

- [ ] **Step 5: Merge.** After merging, confirm the production cron appears under Settings → Cron Jobs, and that the first scheduled run returns 200 in the logs.
- [ ] **Step 6: Commit the runbook update** with the message `docs(deploy): Phase 2 cron, feeds and sync runbook`.

---

## Done when

- `pnpm check`, `pnpm knip:production` and `DATABASE_URL= pnpm --filter web build` pass, and CI is green.
- A preview synced a real feed, and search, online and detail return its meetings.
- Production runs the sync cron every 15 minutes, with Pro active.
- Spec §14 criteria covered here:
  - The failing-feed isolation test passes.
  - The slug-rename test passes.
  - No contact fields are stored (normalizer test).
  - Only rounded coordinates are accepted, and only in the POST body (search tests).
