# Phase 4: Website and Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A calm public website (landing page, privacy policy generated from the spec's data inventory, terms, support and opt-out page, robots.txt, sitemap, Open Graph and `MobileApplication` data) and a password-protected `/metrics` dashboard. The dashboard shows totals only and has admin views for suggestion review, swing flags and device blocking, opt-outs and retiring tags. Everything runs on the Vercel address, with the canonical URL in one variable.

**Architecture:**

- **Public site.** Server components under `src/app/(site)`, statically rendered at build time. The root layout loads Atkinson Hyperlegible through `next/font`, which self-hosts it, and adds the footer disclaimer. There are no client components, no cookies and no third-party scripts. Every absolute URL comes from `siteUrl()`, which reads `SITE_URL`.
- **Privacy policy.** The policy renders `src/content/privacy-inventory.ts`. A test parses SPEC.md §13 (both tables) and §2 (third parties) and the Drizzle schema, and fails if any of them drift from the policy. Retention numbers come from one `RETENTION` constant, which the maintenance cron, the tag counts and the swing check also use. Policy and code therefore can't disagree.
- **Admin gate.** `src/proxy.ts` (Next.js 16's replacement for middleware, Node.js runtime) matches `/metrics` and `/metrics/:path*`. It:
  - refuses any non-GET/HEAD request from another origin;
  - checks HTTP Basic credentials in constant time;
  - counts failed sign-ins in `rate_limits` (one site-wide bucket);
  - marks every response `no-store` and `noindex`.
- **Admin views.** Server components call functions in `src/server/admin/*`, which return totals or the single records an action needs. Changes are Server Actions built by `adminAction(path, schema, run)`. It re-checks the credentials, validates the form with zod and redirects back with `?notice=…`, so every form also works without JavaScript.
- **End-to-end tests.** `pnpm --filter web test:e2e` builds the app with no database, runs `next start` against the test database and drives it over HTTP. This covers the parts vitest can't call: `proxy.ts` in place, Server Actions with Next's own origin check, real response headers and static pages.

**Tech Stack:** Next.js 16.3 App Router (server components, `proxy.ts`, Server Actions, metadata API, `robots.ts`, `sitemap.ts`, `next/font/google`), React 19.3 (`react-dom/server` for page tests), Drizzle ORM 0.45 + `pg`, PostGIS 17, zod 4, vitest 5.

**Spec:** `SPEC.md` (v2): §2, §5 (suggestion review, retiring tags), §6 (swing review, blocking), §9, §10, §13, §14, §16. Roadmap: `docs/superpowers/plans/2026-09-26-roadmap.md` (Phase 4). Standards: `docs/standards.md` (binding).

**Depends on:** Phases 1, 2, 3 and 7 merged (`main` at 4db9cf3 or later). The admin views reuse:

- `tag_swings`, `tag_audit`, `suggestions`, `ai_decisions`, `meetings.tags_disabled`, `feeds.opted_out` and `feeds.last_error`;
- `blockDevice` (`src/server/devices/block-device.ts`) and `findOwnSubmissions` (`src/server/tags/own-submissions.ts`);
- `getActiveVocabulary` (`src/server/vocabulary.ts`) and `primarySourceJoin` (`src/server/meetings/summary.ts`);
- `consumeDailyLimit` (`src/server/devices/rate-limit.ts`).

## Owner decisions needed

Each item has a recommendation, and the plan is written to follow it so work isn't blocked. Say so if you want something different.

1. **Feed health threshold.** SPEC §10 says to "flag feeds without a successful sync in 30 hours". That was written before Phase 2 moved every feed to a weekly sync (§3: a feed is fetched once its last success is over 7 days old, and a failed one is retried after a day). With the 30-hour rule, almost every healthy feed would show as failing. **Recommendation:** a feed needs attention when it isn't opted out and either its last attempt failed (`last_error` is set) or it has been tried but hasn't succeeded in 8 days (the 7-day cadence plus the 1-day retry). Task 7 applies this and updates SPEC §10.
2. **Failed sign-in limit.** The limit can't be per person without storing an IP address or something like it, which §2 rules out. **Recommendation:** one site-wide counter in `rate_limits` (bucket `metrics_login`), with 20 failed sign-ins per UTC day. After that, everyone is refused until midnight UTC, the owner included, so guessing can't go on. The password is random and at least 16 characters, so the only realistic risk is that someone locks you out for the rest of a day. `docs/deploy.md` gets the one-line SQL that clears it.
3. **How long deleted data stays in backups.** Neon keeps history for point-in-time restore. How long depends on the plan and the project's setting, and the owner can change it. **Recommendation:** the draft policy says deleted data "can remain in our database provider's restore history for up to 30 days", which covers any Neon plan today. Task 12 has you check the project's actual setting and shorten the wording if you prefer. The legal review (§16) can settle the final text.
4. **The feed User-Agent names `mymeetingapp.com`,** which isn't connected yet (`BRAND.domain` in `packages/shared/src/brand.ts`). Intergroup webmasters who follow the link find nothing, although the contact email in the same header works. **Recommendation:** leave it. It becomes correct the moment the domain is connected, and changing it now would mean changing it back later.

## Decisions this plan makes (confirm at review)

1. **Canonical URL.** `SITE_URL` is required and must be an origin with no path, such as `https://mymeetingapp.vercel.app`; a trailing slash is dropped.
   - A missing or malformed value fails the build, so wrong links are never published.
   - Production and Preview both use the production address. Previews are protected and never indexed, and their links pointing at production is harmless.
   - Tests use `https://mymeetingapp.test`.
   - Connecting `mymeetingapp.com` later is a Vercel domain step, a new `SITE_URL` value and a redeploy (Task 12 writes the steps down).
2. **Font.** `next/font/google` with `Atkinson_Hyperlegible`, weights 400 and 700, Latin subset.
   - Next downloads the files at build time and serves them from this site, so no visitor's browser contacts Google.
   - The build needs network access, which Vercel and GitHub Actions have.
3. **No client components.**
   - Internal links are plain `<a>` elements.
   - The e2e smoke test asserts that no page sets a cookie or loads a script from another origin.
   - There is no analytics and no Vercel Web Analytics or Speed Insights (§2).
4. **Open Graph without an image.**
   - Pages get title, description, canonical URL, site name and type, plus a `summary` Twitter card. A generated image can come later.
   - The iOS Smart App Banner and store links wait for store IDs (Phase 6). The store buttons say "coming soon" and aren't links.
5. **`MobileApplication` structured data** carries name, operating systems, category (`LifestyleApplication`), a free offer and the publisher, with no rating. The app has no ratings by design, so Google won't show a rich result. The data is still valid.
6. **Retention constants.** `RETENTION` in `src/server/retention.ts` replaces the literal intervals in `maintenance.ts`, `counts.ts` and `swings.ts` (a refactor under green tests). The policy's retention sentences are built from the same constants.
7. **Both legal pages carry "Draft, pending legal review".** The §16 legal review stays open.
8. **End-to-end tests** (`test/*.e2e.ts`, `vitest.e2e.config.ts`) run against `next build` + `next start` on port 3107.
   - The e2e script builds with `DATABASE_URL=` (empty), so it also enforces "nothing queries the database at build time".
   - CI swaps its bare build step for it, which adds roughly two minutes.
   - It isn't part of `pnpm check`. Tasks that touch the proxy, pages or Server Actions run it explicitly, and every phase ends with it.
9. **CSRF.** `proxy.ts` refuses any non-GET/HEAD request to `/metrics` whose `Origin` doesn't match the host (`x-forwarded-host`, else `host`), and one with no `Origin`, before any credentials are checked.
   - Basic credentials ride along on cross-site requests, so this is the real protection.
   - Next.js checks Server Actions the same way, but it logs the mismatched header values. Refusing first keeps them out of the logs.
10. **`proxy.ts` is the one file that may import `NextResponse`,** for `NextResponse.next({ headers })`. ESLint exempts only that file.
11. **Admin actions re-check the credentials** inside every Server Action (`adminAction`), as the Next.js docs advise, so moving an action can never leave it unguarded. They answer with a 303 redirect to the same page plus `?notice=<code>`, and the page shows a fixed message for that code.
12. **Suggestion review.**
    - A new status, `approved`, means the suggestion became a new tag. `merged_tag_id` holds the tag for both `approved` and `merged`.
    - Approving derives the slug from the label: accents are folded, `&` becomes "and", and apostrophes are dropped. The new tag goes last in the vocabulary order.
    - Every review sets `device_hash = null` and `reviewed_at`, and applies only to a still-pending suggestion, so a double submit changes nothing.
13. **Swing review.**
    - The devices behind a flag are those in `tag_audit` for that meeting within the last 7 days whose current row on the meeting (found with `findOwnSubmissions`, merged-away scopes included) holds the flagged tag.
    - The page shows each hash's first 12 characters. Blocking re-checks that the hash is one of these devices, then calls `blockDevice`.
    - This is the only admin page that shows anything per device, and only for one meeting (§6).
14. **Opt-outs.**
    - A group opt-out takes effect at once. Cached meeting responses catch up within 5 minutes.
    - A feed opt-out takes effect at the next sync, within 15 minutes (the sync's existing `archiveOptedOutFeeds`).
    - Opting a feed back in clears `last_success_at` and `last_attempt_at`, so it's fetched on the next sync.
15. **Vocabulary.** Retire and restore only; nothing is ever deleted (§5). New tags arrive through suggestion approval. The app's cached vocabulary catches up within an hour.
16. **Metric definitions.**
    - "Active in 7/30 days": `last_seen_date` within the last 7/30 UTC days, today included.
    - "Tag submissions this week": non-excluded rows confirmed in the last 7 days, re-confirmations included.
    - "Submissions per day": by UTC date of `confirmed_at`, for 14 days, zero days included.
    - "Top tags": devices per tag over rows confirmed in the last 30 days.
    - "Platform split": all device records.
17. **Domain.** Connecting `mymeetingapp.com` leaves Phase 4 (owner decision, binding 2026-09-29). Task 12 updates the roadmap.

## Global Constraints

- Everything in `docs/standards.md`:
  - `pnpm check` passes on every commit. `pnpm knip:production` and `pnpm --filter web test:e2e` pass at the end of the phase.
  - Test-driven: a failing test first.
  - No dead code.
  - One way per concern: `readEnv`, `logError`, the `db` client only from `src/server` or `src/db`, `sqlStringList`/`sqlArray`, `consumeDailyLimit`, `blockDevice`, and `findOwnSubmissions` for a device's rows.
  - Casts only after runtime checks.
- Spec §2: "No accounts. No name, email, phone, or login anywhere." (The admin's Basic Auth is the owner's, not a user account.)
- Spec §2: "The server must not be able to list the meetings one device has tagged, apart from a 7-day abuse-review log." No admin view lists a device's meetings.
- Spec §2: "No ads, no analytics SDKs, no tracking, and no cookies or analytics on the website (no Vercel Web Analytics or Speed Insights)."
- Spec §2: "Metrics show totals only, never per-device rows."
- Spec §2: "Don't log IP addresses beyond the platform's short-term request logs, and never log request headers or bodies." `proxy.ts` logs nothing about a request.
- Spec §2: "Third parties that receive data must each be listed in the privacy policy: Vercel (hosting, request logs), Neon (database), Apple and Google (maps, platform geocoder, app attestation), and the AI provider used for suggestion screening (zero data retention)." The current model is `openai/gpt-5-nano` (docs/deploy.md).
- Spec §5: "Tags can be retired (hidden, counts kept) but never hard-deleted." "The admin reviews pending suggestions in a weekly batch (approve, merge, reject)." "Suggestions store `device_hash` only until reviewed or for 30 days."
- Spec §6: "`tag_audit(device_hash, meeting_id, action, at)`, purged after 7 days. This is the only place a device is linked to meetings, and it exists so the admin can identify and block devices behind a flagged swing."
- Spec §9: "Public pages, statically rendered, fast, and accessible."
  - The terms cover non-affiliation with AA and A.A. World Services, listings possibly out of date, not medical advice, and Tennessee governing law.
  - "The privacy policy matches the data inventory in section 13 exactly, including the third parties in section 2 and that deleted data may persist in database backups for up to the Neon point-in-time-restore window."
  - "Footer on every page: non-affiliation statement."
  - "`robots.txt` (disallow `/metrics`, `/api/`), sitemap, Open Graph tags, `MobileApplication` structured data."
  - Design: "calm, plain, highly legible (Atkinson Hyperlegible, self-hosted via `next/font`), light and dark mode, left-aligned single column, no stock-template look."
- Spec §10: "HTTP Basic Auth in `proxy.ts` …, constant-time credential comparison, HTTPS only, `noindex`, `no-store`, rate-limited failed logins." "Admin actions use Server Actions (Next.js checks the request origin)." "Server components query Postgres directly; no public metrics endpoint."
- Spec §12: `METRICS_USER` and `METRICS_PASSWORD` are Vercel environment variables, never committed.
- Owner decisions (binding, 2026-09-29):
  - **Domain:** no domain yet. `SITE_URL` is the one setting.
  - **Legal pages:** policy and terms are drafted in plain language and marked "Draft, pending legal review".
  - **Design:** calm and simple. Atkinson Hyperlegible, light and dark, generous whitespace, no stock photos, one screenshot placeholder, store buttons marked "coming soon", the privacy promise up front and the footer disclaimer.
  - **Support contact:** `admin@goodersoftwarellc.com` (`BRAND.contactEmail`).
- Nothing in this phase touches production, Vercel or Neon except Task 12, which is done with the owner.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019qtuWT6wkew2g1c4qi6eKc
  ```

## Review Focus

1. **A review form submitted twice** (a double click, or the back button and resubmit). The second submission must change nothing (no second tag, no status flip) and say the suggestion was already reviewed. Pinned in Task 8 ("a second review of the same suggestion changes nothing").
2. **Approving a label that makes an existing tag's slug** ("Laid-back" for `laid-back`) **or no slug at all** (a label in another script). The admin must be told to merge instead, or to use Latin letters, and the suggestion stays pending. Pinned in Task 8 ("refuses a label that makes an existing tag's slug", "refuses a label with no letters a–z").
3. **A device leaves the swing review between listing and clicking "Block"** (it ran delete-mine, or its audit rows aged past 7 days). The review must stop listing it, and a stale Block click must answer "not in this review", never a 500. Pinned in Task 9 ("drops a device whose audit rows are over 7 days old", "drops a device that deleted its data, and a stale block click does nothing").
4. **A failing feed whose `last_error` is huge** (an HTML error page or a long parser message). `/metrics` must still render, with the error cut to 300 characters. Pinned in Task 7 ("cuts a long error to 300 characters").
5. **`SITE_URL` set carelessly** (`https://mymeetingapp.vercel.app/` with a trailing slash, no scheme, or a path). Links must never contain `//`, and a value that isn't an origin must fail the build. Pinned in Task 1 ("drops a trailing slash", "refuses a value that isn't an http(s) origin").

---

## File structure

```
.github/workflows/ci.yml          build + end-to-end tests replace the bare build step
knip.json                         apps/web test project includes .tsx
eslint.config.js                  proxy.ts may import NextResponse
CLAUDE.md, docs/standards.md, docs/deploy.md, SPEC.md (§10, §13), roadmap
packages/shared/src/brand.ts      + publisher
packages/shared/src/suggestions.ts TagLabelText (shared by SuggestionRequest and admin approval)
apps/web/
  tsconfig.json                   jsx: react-jsx, DOM libs
  package.json                    @types/react-dom; test:e2e
  vitest.config.ts                + SITE_URL
  vitest.e2e.config.ts            e2e project (merges vitest.config.ts)
  .env.example                    + SITE_URL, METRICS_USER, METRICS_PASSWORD
  src/env.ts                      + SITE_URL, METRICS_USER, METRICS_PASSWORD
  src/proxy.ts                    Basic Auth, same-origin, no-store/noindex for /metrics
  src/lib/site-url.ts             siteUrl()
  src/lib/page-metadata.ts        pageMetadata(), SITE_DESCRIPTION
  src/lib/constant-time.ts        constantTimeEqual() (cron-auth uses it too)
  src/lib/admin-auth.ts           isAdminAuthorization()
  src/content/privacy-inventory.ts DATA_INVENTORY, ON_PHONE, THIRD_PARTIES
  src/components/                 site-header, site-footer, privacy-promise, store-badges, screenshot-placeholder,
                                  example-meeting-card, help-resources, mobile-app-json-ld, draft-notice
  src/app/layout.tsx              root: font, globals.css, metadataBase, footer
  src/app/globals.css             light/dark tokens, single column
  src/app/robots.ts, sitemap.ts
  src/app/(site)/layout.tsx       header + main
  src/app/(site)/page.tsx         landing
  src/app/(site)/privacy/page.tsx, terms/page.tsx, support/page.tsx
  src/app/metrics/layout.tsx      admin nav, noindex metadata
  src/app/metrics/page.tsx        totals and feed health
  src/app/metrics/notice.tsx      Notice, SearchParams
  src/app/metrics/admin-action.ts adminAction()
  src/app/metrics/actions.ts      "use server": every admin Server Action
  src/app/metrics/suggestions/page.tsx
  src/app/metrics/swings/page.tsx, swings/[id]/page.tsx
  src/app/metrics/opt-outs/page.tsx
  src/app/metrics/vocabulary/page.tsx
  src/db/schema/tagging.ts        + rate-limit bucket metrics_login
  src/db/schema/suggestions.ts    + status approved
  src/server/retention.ts         RETENTION
  src/server/maintenance.ts, tags/counts.ts, tags/swings.ts   use RETENTION
  src/server/sync/run-sync.ts     + FEED_OVERDUE_AFTER
  src/server/vocabulary.ts        + VOCABULARY_ORDER
  src/server/devices/rate-limit.ts + metrics_login limit, dailyLimitReached()
  src/server/admin/login-guard.ts checkAdminLogin()
  src/server/admin/notices.ts     ADMIN_NOTICES, AdminNotice, isAdminNotice()
  src/server/admin/form-fields.ts FormId, FormBoolean
  src/server/admin/metrics.ts     readMetrics(), readFeedsNeedingAttention()
  src/server/admin/suggestions.ts review functions and forms
  src/server/admin/swings.ts      swing review, block, close
  src/server/admin/opt-outs.ts    meeting and feed opt-outs
  src/server/admin/vocabulary.ts  listVocabulary(), setTagRetired()
  drizzle/0013_lock-timeout-admin.sql, 0014_metrics-login-limit.sql, 0015_suggestion-approved.sql
  test/render.ts                  renderText()
  test/e2e-server.ts              globalSetup: next start; E2E_URL, ADMIN_AUTHORIZATION
  test/e2e-forms.ts               adminGet(), formContaining(), submitForm()
  test/*.e2e.ts                   end-to-end tests
```

---

### Task 1: Site shell, landing page core and the end-to-end harness

The first pages in `apps/web`. The root layout loads the font through `next/font`, which vitest can't import, so the layout is driven by an end-to-end test against the built app. That harness lands here too.

**Files:**

- Create:
  - `apps/web/vitest.e2e.config.ts`, `apps/web/test/e2e-server.ts`, `apps/web/test/site.e2e.ts`
  - `apps/web/test/render.ts`, `apps/web/test/site-url.test.ts`, `apps/web/test/page-metadata.test.ts`, `apps/web/test/landing-page.test.tsx`
  - `apps/web/src/lib/site-url.ts`, `apps/web/src/lib/page-metadata.ts`
  - `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/app/(site)/layout.tsx`, `apps/web/src/app/(site)/page.tsx`
  - `apps/web/src/components/site-header.tsx`, `apps/web/src/components/site-footer.tsx`, `apps/web/src/components/privacy-promise.tsx`
- Modify:
  - `apps/web/tsconfig.json`, `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/src/env.ts`, `apps/web/.env.example`
  - `packages/shared/src/brand.ts`, `knip.json`, `.github/workflows/ci.yml`, `docs/standards.md`, `CLAUDE.md`

**Interfaces:**

- Produces:
  - `siteUrl(): string` from `@/lib/site-url`: the origin with no trailing slash. It throws `Error("SITE_URL must be an http(s) origin such as https://mymeetingapp.vercel.app")` when the value is unset or isn't an origin.
  - `pageMetadata(page: { path: string; title: string; description: string }): Metadata` and `SITE_DESCRIPTION: string` from `@/lib/page-metadata`.
  - `renderText(element: ReactElement): string` from `test/render.ts`: a page's visible text with tags stripped, entities decoded and whitespace collapsed.
  - `E2E_URL` (`"http://localhost:3107"`) from `test/e2e-server.ts`.
  - The `pnpm --filter web test:e2e` script.
  - `BRAND.publisher` (`"Gooder Software LLC"`).
  - CSS classes that later tasks use: `page`, `site-header`, `wordmark`, `lede`, `promise`, `fine-print`, `site-footer`, `notice`, `draft-notice`, `store-badges`, `store-badge`, `screenshot-placeholder`, `meeting-card`, `meeting-name`, `meeting-meta`, `tag-list`, `count`, `admin`, `totals`, `review`, `inline`, `secondary`.

- [ ] **Step 1: Let TypeScript compile TSX.** Run `pnpm --filter web add -D @types/react-dom@19.3.0`. Replace `apps/web/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"],
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "test", "scripts", "*.ts"]
}
```

In `knip.json`, change the `apps/web` project list to `["src/**/*.{ts,tsx}!", "scripts/**/*.ts!", "test/**/*.{ts,tsx}", "*.ts"]`. In `packages/shared/src/brand.ts`, add `publisher: "Gooder Software LLC",` after `contactEmail`. Run `pnpm typecheck`. Expected: PASS.

- [ ] **Step 2: Write the failing `siteUrl` test.** Create `apps/web/test/site-url.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { siteUrl } from "@/lib/site-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("siteUrl", () => {
  it("is the configured origin", () => {
    vi.stubEnv("SITE_URL", "https://mymeetingapp.vercel.app");
    expect(siteUrl()).toBe("https://mymeetingapp.vercel.app");
  });

  it("drops a trailing slash", () => {
    vi.stubEnv("SITE_URL", "https://mymeetingapp.vercel.app/");
    expect(siteUrl()).toBe("https://mymeetingapp.vercel.app");
  });

  it.each([
    undefined,
    "mymeetingapp.vercel.app",
    "ftp://mymeetingapp.vercel.app",
    "https://mymeetingapp.vercel.app/app",
    "https://mymeetingapp.vercel.app/?ref=x",
  ])("refuses a value that isn't an http(s) origin: %j", (value) => {
    vi.stubEnv("SITE_URL", value);
    expect(() => siteUrl()).toThrow(
      "SITE_URL must be an http(s) origin such as https://mymeetingapp.vercel.app",
    );
  });
});
```

- [ ] **Step 3: Run it and watch it fail.** Run `pnpm --filter web exec vitest run site-url`. Expected: FAIL, because `@/lib/site-url` doesn't exist.

- [ ] **Step 4: Implement `siteUrl`.** In `apps/web/src/env.ts`, add `| "SITE_URL"` to `EnvName`. Create `apps/web/src/lib/site-url.ts`:

```ts
import { readEnv } from "@/env";

// The site's canonical origin, for the sitemap, robots.txt, Open Graph and canonical links. Connecting a domain
// later is a Vercel domain step plus a new SITE_URL. A missing or malformed value fails the build rather than
// publishing wrong links.
export function siteUrl(): string {
  const value = readEnv("SITE_URL");
  const url = value === undefined ? null : URL.parse(value);
  if (
    url === null ||
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("SITE_URL must be an http(s) origin such as https://mymeetingapp.vercel.app");
  }
  return url.origin;
}
```

In `apps/web/vitest.config.ts`, add this to `test.env`:

```ts
      // Every absolute URL a test expects starts with this.
      SITE_URL: "https://mymeetingapp.test",
```

In `apps/web/.env.example`, add `SITE_URL=http://localhost:3000`.

- [ ] **Step 5: Run it and watch it pass.** Run `pnpm --filter web exec vitest run site-url`. Expected: PASS.

- [ ] **Step 6: Write the failing page tests and the end-to-end harness.** Create `apps/web/test/render.ts`:

```ts
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A server component's visible text as the browser first gets it: tags removed, entities decoded, whitespace
// collapsed. Assertions on wording use this, so they don't depend on markup or on how React escapes quotes.
export function renderText(element: ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
```

Create `apps/web/test/page-metadata.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { pageMetadata } from "@/lib/page-metadata";

describe("pageMetadata", () => {
  it("gives a page its title, description, canonical link and Open Graph card", () => {
    expect(
      pageMetadata({ path: "/privacy", title: "Privacy policy", description: "How we handle data." }),
    ).toEqual({
      title: "Privacy policy · mymeetingapp",
      description: "How we handle data.",
      alternates: { canonical: "/privacy" },
      openGraph: {
        title: "Privacy policy · mymeetingapp",
        description: "How we handle data.",
        url: "/privacy",
        siteName: "mymeetingapp",
        type: "website",
        locale: "en_US",
      },
    });
  });
});
```

Create `apps/web/test/landing-page.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";

import HomePage, { metadata } from "@/app/(site)/page";

import { renderText } from "./render";

describe("the landing page", () => {
  it("leads with the privacy promise, before explaining the tags", () => {
    const text = renderText(<HomePage />);
    const promise = text.indexOf("No account.");
    expect(promise).toBeGreaterThan(-1);
    expect(promise).toBeLessThan(text.indexOf("Descriptions, not ratings"));
    expect(text).toContain("Your exact location stays on your phone.");
    expect(text).toContain("No ads, no tracking, no analytics and no cookies,");
  });

  it("is the canonical home page", () => {
    expect(metadata).toMatchObject({ alternates: { canonical: "/" }, openGraph: { url: "/" } });
  });
});
```

Create `apps/web/test/e2e-server.ts`:

```ts
import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";

import type { TestProject } from "vitest/node";

// The built app (`next build`, run by test:e2e first) served by `next start` against the test database, so these
// tests see what Vercel serves: proxy.ts in place, Server Actions with Next's own checks, real headers and the
// static pages as built.
const PORT = 3107;
export const E2E_URL = `http://localhost:${String(PORT)}`;
const WEB_ROOT = path.resolve(import.meta.dirname, "..");

async function serving(): Promise<boolean> {
  try {
    return (await fetch(`${E2E_URL}/`)).ok;
  } catch {
    return false;
  }
}

async function waitUntilServing(server: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`next start exited with code ${String(server.exitCode)}`);
    if (await serving()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("next start didn't serve / within 60 seconds");
}

export default async function setup(project: TestProject): Promise<() => void> {
  // A server left over from a crashed run would answer for the new build.
  if (await serving()) throw new Error(`port ${String(PORT)} is already in use; stop the old server first`);
  const server = spawn(
    process.execPath,
    [path.join(WEB_ROOT, "node_modules/next/dist/bin/next"), "start", "--port", String(PORT)],
    {
      cwd: WEB_ROOT,
      // Vitest sets NODE_ENV=test; next start must run as production.
      env: { ...process.env, ...project.config.env, NODE_ENV: "production" },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  await waitUntilServing(server);
  return () => {
    server.kill();
  };
}
```

Create `apps/web/vitest.e2e.config.ts`:

```ts
import { defineConfig, mergeConfig } from "vitest/config";

import base from "./vitest.config";

// End-to-end tests against the built app; `pnpm --filter web test:e2e` builds it first. Same database, env and
// one-file-at-a-time rule as the unit tests. The base global setup migrates the database before the server starts.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["test/**/*.e2e.ts"],
      globalSetup: ["./test/e2e-server.ts"],
      testTimeout: 30_000,
    },
  }),
);
```

In `apps/web/package.json`, add this script:

```json
    "test:e2e": "DATABASE_URL= SITE_URL=https://mymeetingapp.test next build && vitest run --config vitest.e2e.config.ts",
```

Create `apps/web/test/site.e2e.ts`:

```ts
import { describe, expect, it } from "vitest";

import { E2E_URL } from "./e2e-server";

describe("the public site", () => {
  it("serves the landing page with the footer disclaimer and a self-hosted font", async () => {
    const res = await fetch(`${E2E_URL}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("is not affiliated with or endorsed by Alcoholics Anonymous");
    expect(html).toMatch(/<link[^>]+href="\/_next\/static\/media\/[^"]+\.woff2"/);
    expect(html).not.toContain("fonts.googleapis.com");
  });

  it("sets no cookies and loads no script from another site (spec §2)", async () => {
    const res = await fetch(`${E2E_URL}/`);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).not.toMatch(/<script[^>]+src="https?:\/\//);
  });
});
```

- [ ] **Step 7: Run them and watch them fail.** Run `pnpm --filter web exec vitest run page-metadata landing-page`. Expected: FAIL, because the modules are missing. Then run `docker compose up -d` and `pnpm --filter web test:e2e`. Expected: the build succeeds (there's no page yet), then both e2e tests FAIL with status 404.

- [ ] **Step 8: Implement the shell and the landing page.** Create `apps/web/src/lib/page-metadata.ts`:

```ts
import { BRAND } from "@mymeetingapp/shared";
import type { Metadata } from "next";

export const SITE_DESCRIPTION =
  "Find AA meetings near you and see how attendees describe them. Free, with no account, no ads and no tracking.";

// The one way a page names itself. Next.js replaces a layout's openGraph object rather than merging it, so every
// page's card carries the site name, type and locale itself. Relative URLs resolve against the root layout's
// metadataBase (SITE_URL).
export function pageMetadata(page: { path: string; title: string; description: string }): Metadata {
  const title = `${page.title} · ${BRAND.appName}`;
  return {
    title,
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: {
      title,
      description: page.description,
      url: page.path,
      siteName: BRAND.appName,
      type: "website",
      locale: "en_US",
    },
  };
}
```

Create `apps/web/src/app/layout.tsx`:

```tsx
import { BRAND } from "@mymeetingapp/shared";
import type { Metadata } from "next";
import { Atkinson_Hyperlegible } from "next/font/google";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import { SITE_DESCRIPTION } from "@/lib/page-metadata";
import { siteUrl } from "@/lib/site-url";

import "./globals.css";

// Self-hosted: next/font downloads the files at build time and serves them from this site, so no visitor's browser
// contacts Google (spec §2, §9).
const atkinson = Atkinson_Hyperlegible({ weight: ["400", "700"], subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  applicationName: BRAND.appName,
  description: SITE_DESCRIPTION,
  twitter: { card: "summary" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={atkinson.className}>
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
```

Create `apps/web/src/app/globals.css`:

```css
/* Calm and plain (spec §9): one left-aligned column, generous space, light and dark from the system setting. */
:root {
  color-scheme: light dark;
  --bg: #fbfaf7;
  --surface: #ffffff;
  --text: #1d2327;
  --muted: #55606a;
  --line: #dcd8cf;
  --accent: #1f5f8b;
  --accent-text: #ffffff;
  --tag-bg: #eef3f7;
  --notice-bg: #fff6d6;
  --gutter: 1.25rem;
  --measure: 40rem;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15191c;
    --surface: #1d2226;
    --text: #eceff1;
    --muted: #a9b3bb;
    --line: #333b41;
    --accent: #8cc4ec;
    --accent-text: #0e1418;
    --tag-bg: #243039;
    --notice-bg: #3a3218;
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  font-size: 112.5%;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}

a {
  color: var(--accent);
  text-underline-offset: 0.2em;
}

:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

.site-header,
.page,
.site-footer {
  max-width: var(--measure);
  margin: 0 auto;
  padding-inline: var(--gutter);
}

.site-header {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
  align-items: baseline;
  padding-block: 1.5rem;
}

.site-header nav,
.site-footer nav {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.wordmark {
  font-weight: 700;
  color: var(--text);
  text-decoration: none;
}

.page {
  padding-bottom: 4rem;
}

h1 {
  font-size: 2rem;
  line-height: 1.25;
  margin: 2rem 0 1rem;
}

h2 {
  font-size: 1.35rem;
  line-height: 1.3;
  margin: 3rem 0 0.75rem;
}

h3 {
  font-size: 1.1rem;
  margin: 2rem 0 0.5rem;
}

.lede {
  font-size: 1.15rem;
  color: var(--muted);
}

.promise {
  list-style: none;
  margin: 1.5rem 0;
  padding: 1rem 1.25rem;
  border-left: 4px solid var(--accent);
  background: var(--surface);
}

.promise li + li {
  margin-top: 0.5rem;
}

.fine-print,
figcaption {
  color: var(--muted);
  font-size: 0.9rem;
}

.notice,
.draft-notice {
  background: var(--notice-bg);
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
}

.store-badges {
  list-style: none;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.store-badge {
  display: inline-block;
  padding: 0.6rem 1rem;
  border: 2px solid var(--line);
  border-radius: 0.6rem;
  color: var(--muted);
}

.screenshot-placeholder {
  aspect-ratio: 9 / 19.5;
  width: min(16rem, 100%);
  margin: 2rem 0;
  display: grid;
  place-items: center;
  border: 2px dashed var(--line);
  border-radius: 2rem;
  color: var(--muted);
}

.meeting-card {
  margin: 1.5rem 0;
  padding: 1.25rem;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 0.75rem;
}

.meeting-name {
  font-weight: 700;
  font-size: 1.1rem;
  margin: 0.25rem 0;
}

.meeting-meta {
  color: var(--muted);
  margin: 0;
}

.tag-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0 0.5rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.tag-list li {
  background: var(--tag-bg);
  border-radius: 999px;
  padding: 0.2rem 0.75rem;
}

.count {
  font-weight: 700;
}

table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.95rem;
}

th,
td {
  text-align: left;
  vertical-align: top;
  padding: 0.5rem 0.75rem 0.5rem 0;
  border-bottom: 1px solid var(--line);
}

.site-footer {
  border-top: 1px solid var(--line);
  padding-block: 1.5rem 3rem;
  color: var(--muted);
  font-size: 0.9rem;
}

/* Admin pages: wider, same calm look. */
.admin {
  max-width: 64rem;
}

.totals {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: 1rem;
}

.totals div {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
}

.totals dt {
  color: var(--muted);
  font-size: 0.9rem;
}

.totals dd {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
}

.review {
  border-bottom: 1px solid var(--line);
  padding-bottom: 1rem;
}

form.inline {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin: 0.25rem 0.75rem 0.25rem 0;
}

button,
input,
select {
  font: inherit;
  border-radius: 0.4rem;
}

button {
  padding: 0.35rem 0.9rem;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--accent-text);
  cursor: pointer;
}

button.secondary {
  background: transparent;
  color: var(--accent);
}

input,
select {
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text);
}
```

Create `apps/web/src/components/site-header.tsx`:

```tsx
import { BRAND } from "@mymeetingapp/shared";

// Plain links: the site ships no client-side navigation of its own.
export function SiteHeader() {
  return (
    <header className="site-header">
      <a className="wordmark" href="/">
        {BRAND.appName}
      </a>
      <nav aria-label="Site">
        <a href="/support">Support</a>
        <a href="/privacy">Privacy</a>
      </nav>
    </header>
  );
}
```

Create `apps/web/src/components/site-footer.tsx`:

```tsx
import { BRAND } from "@mymeetingapp/shared";

// Spec §9: the non-affiliation statement on every page, admin pages included.
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>
        {BRAND.appName} is not affiliated with or endorsed by Alcoholics Anonymous or A.A. World Services,
        Inc.
      </p>
      <nav aria-label="Legal">
        <a href="/privacy">Privacy policy</a>
        <a href="/terms">Terms of use</a>
        <a href="/support">Support</a>
      </nav>
      <p>© {BRAND.publisher}</p>
    </footer>
  );
}
```

Create `apps/web/src/components/privacy-promise.tsx`:

```tsx
// Owner decision: the privacy promise comes first. Each line restates spec §2 in plain words.
export function PrivacyPromise() {
  return (
    <>
      <ul className="promise" aria-label="Our privacy promise">
        <li>
          <strong>No account.</strong> No name, email, phone number or sign-in, ever.
        </li>
        <li>
          <strong>Your exact location stays on your phone.</strong> A search sends only a point rounded to
          about 1 km, and we don't keep it.
        </li>
        <li>
          <strong>Your sobriety date and favorites stay on your phone.</strong>
        </li>
        <li>
          <strong>No ads, no tracking, no analytics and no cookies,</strong> in the app or on this site.
        </li>
      </ul>
      <p>
        <a href="/privacy">How we handle data</a>
      </p>
    </>
  );
}
```

Create `apps/web/src/app/(site)/layout.tsx`:

```tsx
import type { ReactNode } from "react";

import { SiteHeader } from "@/components/site-header";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="page">{children}</main>
    </>
  );
}
```

Create `apps/web/src/app/(site)/page.tsx`:

```tsx
import { PrivacyPromise } from "@/components/privacy-promise";
import { pageMetadata, SITE_DESCRIPTION } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  path: "/",
  title: "Find AA meetings, described by the people who go",
  description: SITE_DESCRIPTION,
});

export default function HomePage() {
  return (
    <>
      <section aria-labelledby="headline">
        <h1 id="headline">Find an AA meeting that fits, described by the people who go.</h1>
        <p className="lede">
          A free app for iPhone and Android that lists AA meetings near you and shows how attendees describe
          each one, in a few plain words.
        </p>
        <PrivacyPromise />
      </section>
      <section aria-labelledby="descriptions">
        <h2 id="descriptions">Descriptions, not ratings</h2>
        <p>
          After a meeting, attendees can pick up to six words from a fixed list, like “Welcoming”, “Step
          study” or “Easy parking”. The app shows how many people chose each one. There are no stars, no
          scores and no written reviews, so nobody can single out a group or a person.
        </p>
      </section>
    </>
  );
}
```

- [ ] **Step 9: Run the tests and watch them pass.**
  1. Run `pnpm --filter web exec vitest run page-metadata landing-page`. Expected: PASS.
  2. Run `pnpm --filter web test:e2e`. Expected: PASS.
  3. If `next build` rewrote `apps/web/tsconfig.json` (Next adds settings it expects, such as `plugins` or `allowJs`), keep its changes and commit them, so a later build leaves the tree clean.
  4. If `pnpm knip` reports `vitest.e2e.config.ts` or `test/*.e2e.ts` as unused, add them to the `apps/web` `entry` list in `knip.json`.

- [ ] **Step 10: Run the end-to-end tests in CI and write the rules down.**
  1. In `.github/workflows/ci.yml`, replace the "Build without a database" step with:

     ```yaml
     - name: Build without a database, then run the end-to-end tests against it
       run: pnpm --filter web test:e2e
       env:
         NEXT_TELEMETRY_DISABLED: "1"
     ```

  2. In `docs/standards.md` "Definition of done", replace the `DATABASE_URL= pnpm --filter web build` bullet with: "`pnpm --filter web test:e2e` passes. It builds the web app with `DATABASE_URL=` (nothing may query the database at build time), then runs the end-to-end tests against `next start` on the test database."
  3. In "Writing tests" → "Location", add: "End-to-end tests are `apps/web/test/<subject>.e2e.ts`."
  4. Add these rows to the "One way to do each thing" table:

     | Concern                | The one way                                                                                                                                                                                                                    | Enforced by           |
     | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
     | Canonical site URL     | `siteUrl()` from `@/lib/site-url` (reads `SITE_URL`). Never write the host into code                                                                                                                                           | review                |
     | Page metadata          | `export const metadata = pageMetadata({ path, title, description })` from `@/lib/page-metadata`: title, description, canonical link and Open Graph card together                                                               | review                |
     | Pages and components   | Server components in `src/app` and `src/components`. Internal links are plain `<a>`. No client components, cookies or third-party scripts                                                                                      | review, `site.e2e.ts` |
     | Page and request tests | vitest renders a page with `renderText(<Page />)` from `test/render.ts`. Anything needing a real request (proxy.ts, Server Actions, response headers, static output) is an end-to-end test run by `pnpm --filter web test:e2e` | review                |

  5. In `CLAUDE.md` "Commands", add: "- `pnpm --filter web test:e2e`: builds the web app and runs the end-to-end tests against it (needs the docker database). Must pass at the end of each phase."
  6. Run `pnpm check`. Expected: PASS.

- [ ] **Step 11: Commit.**

```bash
git add apps/web knip.json packages/shared/src/brand.ts .github/workflows/ci.yml docs/standards.md CLAUDE.md pnpm-lock.yaml
git commit -m "feat(site): site shell, landing page and end-to-end tests against the built app"
```

---

### Task 2: Landing page: example card, store buttons, screenshot, help and structured data

**Files:**

- Create:
  - `apps/web/src/components/store-badges.tsx`, `apps/web/src/components/screenshot-placeholder.tsx`
  - `apps/web/src/components/example-meeting-card.tsx`, `apps/web/src/components/help-resources.tsx`
  - `apps/web/src/components/mobile-app-json-ld.tsx`
- Modify: `apps/web/src/app/(site)/page.tsx`, `apps/web/test/landing-page.test.tsx`, `apps/web/test/site.e2e.ts`

**Interfaces:**

- Consumes: `siteUrl()`, `SITE_DESCRIPTION`, `renderText`, `BRAND.publisher` (Task 1), `STARTER_VOCABULARY` from `@mymeetingapp/shared`.
- Produces: `HelpResources()`, used again by the support page (Task 4).

- [ ] **Step 1: Write the failing tests.** Add these to `apps/web/test/landing-page.test.tsx`, and add `import { renderToStaticMarkup } from "react-dom/server";` to its imports:

```tsx
describe("the landing page's content", () => {
  it("shows an example meeting described with attendees' words and counts", () => {
    const text = renderText(<HomePage />);
    expect(text).toContain("Welcoming 14");
    expect(text).toContain("Laid back 9");
    expect(text).toContain("Coffee 7");
  });

  it("shows both stores as coming soon, with no store links yet", () => {
    const text = renderText(<HomePage />);
    expect(text).toContain("App Store coming soon");
    expect(text).toContain("Google Play coming soon");
    expect(renderToStaticMarkup(<HomePage />)).not.toMatch(/apps\.apple\.com|play\.google\.com/);
  });

  it("keeps one place for the app screenshot", () => {
    expect(renderToStaticMarkup(<HomePage />)).toContain('aria-label="App screenshot coming soon"');
  });

  it("lists crisis help", () => {
    const text = renderText(<HomePage />);
    expect(text).toContain("call or text 988");
    expect(text).toContain("1-800-662-4357");
  });

  it("describes the app to search engines as a free MobileApplication", () => {
    const html = renderToStaticMarkup(<HomePage />);
    const json = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1] ?? "null";
    const data: unknown = JSON.parse(json);
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "MobileApplication",
      name: "mymeetingapp",
      operatingSystem: "iOS, Android",
      applicationCategory: "LifestyleApplication",
      description:
        "Find AA meetings near you and see how attendees describe them. Free, with no account, no ads and no tracking.",
      url: "https://mymeetingapp.test",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@type": "Organization", name: "Gooder Software LLC" },
    });
  });
});
```

Add this to `apps/web/test/site.e2e.ts`, inside `describe("the public site", …)`:

```ts
it("builds the structured data with the site URL", async () => {
  const html = await (await fetch(`${E2E_URL}/`)).text();
  expect(html).toContain('"@type":"MobileApplication"');
  expect(html).toContain('"url":"https://mymeetingapp.test"');
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `pnpm --filter web exec vitest run landing-page`. Expected: FAIL on every new test. For example, `text` doesn't contain "Welcoming 14".

- [ ] **Step 3: Implement.** Create `apps/web/src/components/store-badges.tsx`:

```tsx
// Owner decision: no store listing exists yet, so the buttons aren't links. They become links in Phase 6.
export function StoreBadges() {
  return (
    <ul className="store-badges" aria-label="Download the app">
      <li>
        <span className="store-badge" aria-disabled="true">
          App Store <small>coming soon</small>
        </span>
      </li>
      <li>
        <span className="store-badge" aria-disabled="true">
          Google Play <small>coming soon</small>
        </span>
      </li>
    </ul>
  );
}
```

Create `apps/web/src/components/screenshot-placeholder.tsx`:

```tsx
// Owner decision: one screenshot area, empty until the app has real screens. No stock photos.
export function ScreenshotPlaceholder() {
  return (
    <div className="screenshot-placeholder" role="img" aria-label="App screenshot coming soon">
      <span aria-hidden="true">Screenshot coming soon</span>
    </div>
  );
}
```

Create `apps/web/src/components/example-meeting-card.tsx`:

```tsx
import { STARTER_VOCABULARY } from "@mymeetingapp/shared";

// A made-up meeting showing the spec §5 display rule: a flat list of words with counts, highest first.
const EXAMPLE_TAGS = [
  ["welcoming", 14],
  ["laid-back", 9],
  ["coffee", 7],
  ["starts-on-time", 5],
] as const;

function labelOf(slug: string): string {
  const tag = STARTER_VOCABULARY.find((candidate) => candidate.slug === slug);
  if (tag === undefined) throw new Error(`no starter tag ${slug}`);
  return tag.label;
}

export function ExampleMeetingCard() {
  return (
    <figure className="meeting-card" aria-label="Example meeting">
      <p className="meeting-meta">Tuesday · 7:00 pm · 0.8 mi</p>
      <p className="meeting-name">Tuesday Night Step Study</p>
      <p className="meeting-meta">Open · In person</p>
      <ul className="tag-list">
        {EXAMPLE_TAGS.map(([slug, count]) => (
          <li key={slug}>
            {labelOf(slug)} <span className="count">{count}</span>
          </li>
        ))}
      </ul>
      <figcaption>An example. Each number is how many attendees chose that word.</figcaption>
    </figure>
  );
}
```

Create `apps/web/src/components/help-resources.tsx`:

```tsx
// Spec §8: 988 and the SAMHSA National Helpline are always reachable, on the site as in the app.
export function HelpResources() {
  return (
    <section aria-labelledby="help">
      <h2 id="help">Need help now?</h2>
      <ul>
        <li>
          <strong>988 Suicide & Crisis Lifeline:</strong> call or text <a href="tel:988">988</a>, any time.
        </li>
        <li>
          <strong>SAMHSA National Helpline:</strong> <a href="tel:18006624357">1-800-662-4357</a>, free and
          confidential, 24 hours a day.
        </li>
        <li>
          Alcoholics Anonymous has its own meeting finder at <a href="https://www.aa.org/find-aa">aa.org</a>.
        </li>
      </ul>
    </section>
  );
}
```

Create `apps/web/src/components/mobile-app-json-ld.tsx`:

```tsx
import { BRAND } from "@mymeetingapp/shared";

import { SITE_DESCRIPTION } from "@/lib/page-metadata";
import { siteUrl } from "@/lib/site-url";

// Spec §9: schema.org MobileApplication. There is no rating on purpose (the app has none), so search engines show
// no rich result, but the facts are there. "<" is escaped so the text can never close the script element.
export function MobileAppJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    name: BRAND.appName,
    operatingSystem: "iOS, Android",
    applicationCategory: "LifestyleApplication",
    description: SITE_DESCRIPTION,
    url: siteUrl(),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: BRAND.publisher },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
```

Replace `apps/web/src/app/(site)/page.tsx` with:

```tsx
import { ExampleMeetingCard } from "@/components/example-meeting-card";
import { HelpResources } from "@/components/help-resources";
import { MobileAppJsonLd } from "@/components/mobile-app-json-ld";
import { PrivacyPromise } from "@/components/privacy-promise";
import { ScreenshotPlaceholder } from "@/components/screenshot-placeholder";
import { StoreBadges } from "@/components/store-badges";
import { pageMetadata, SITE_DESCRIPTION } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  path: "/",
  title: "Find AA meetings, described by the people who go",
  description: SITE_DESCRIPTION,
});

export default function HomePage() {
  return (
    <>
      <MobileAppJsonLd />
      <section aria-labelledby="headline">
        <h1 id="headline">Find an AA meeting that fits, described by the people who go.</h1>
        <p className="lede">
          A free app for iPhone and Android that lists AA meetings near you and shows how attendees describe
          each one, in a few plain words.
        </p>
        <PrivacyPromise />
        <StoreBadges />
        <ScreenshotPlaceholder />
      </section>
      <section aria-labelledby="descriptions">
        <h2 id="descriptions">Descriptions, not ratings</h2>
        <p>
          After a meeting, attendees can pick up to six words from a fixed list, like “Welcoming”, “Step
          study” or “Easy parking”. The app shows how many people chose each one. There are no stars, no
          scores and no written reviews, so nobody can single out a group or a person.
        </p>
        <ExampleMeetingCard />
      </section>
      <HelpResources />
    </>
  );
}
```

- [ ] **Step 4: Run the tests.** Run `pnpm --filter web exec vitest run landing-page`, then `pnpm check`, then `pnpm --filter web test:e2e`. Expected: PASS. The landing page is still static: the build output lists `○ /`.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src apps/web/test
git commit -m "feat(site): landing page example card, store buttons, help resources and structured data"
```

---

### Task 3: The privacy policy, generated from the data inventory

**Files:**

- Create:
  - `apps/web/src/server/retention.ts`, `apps/web/src/content/privacy-inventory.ts`
  - `apps/web/src/components/draft-notice.tsx`, `apps/web/src/app/(site)/privacy/page.tsx`
  - `apps/web/test/privacy-policy.test.tsx`
- Modify (a refactor under green tests): `apps/web/src/server/maintenance.ts`, `apps/web/src/server/tags/counts.ts`, `apps/web/src/server/tags/swings.ts`

**Interfaces:**

- Consumes: `pageMetadata`, `renderText`, `BRAND` (Task 1).
- Produces:
  - `RETENTION` from `@/server/retention`: `{ auditDays: 7, rateLimitDays: 2, suggestionLinkDays: 30, inactiveDeviceMonths: 13, countWindowDays: 180 }`. Task 9 uses `auditDays`.
  - `DATA_INVENTORY`, `ON_PHONE` and `THIRD_PARTIES` from `@/content/privacy-inventory`. Task 6 edits the `rate_limits` entry.
  - `DraftNotice()` from `@/components/draft-notice`, used by the terms (Task 4).

- [ ] **Step 1: Write the failing test.** Create `apps/web/test/privacy-policy.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import path from "node:path";

import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import PrivacyPage from "@/app/(site)/privacy/page";
import { DATA_INVENTORY, ON_PHONE, THIRD_PARTIES } from "@/content/privacy-inventory";
import * as schema from "@/db/schema";

import { renderText } from "./render";

// Spec §14: "Every privacy policy statement maps to a row in section 13 and to behavior in code." These tests
// fail when SPEC.md, the database schema or the policy changes without the others.
const SPEC = readFileSync(path.resolve(import.meta.dirname, "../../../SPEC.md"), "utf8");

// Public meeting data, about no one. The policy describes it in prose ("Meeting listings"), not in the inventory.
const REFERENCE_TABLES = ["address_geocodes", "feed_meetings", "feeds", "meetings", "tags"];

function section(heading: string): string {
  const start = SPEC.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`SPEC.md has no "## ${heading}"`);
  const end = SPEC.indexOf("\n## ", start + 1);
  return SPEC.slice(start, end < 0 ? undefined : end);
}

// The data rows of the nth markdown table in a section, without its header and separator, as trimmed cells with
// backticks removed.
function tableRows(text: string, n: number): string[][] {
  const table = text.split(/\n\s*\n/).filter((block) => block.trimStart().startsWith("|"))[n];
  if (table === undefined) throw new Error(`no table ${String(n)}`);
  return table
    .trim()
    .split("\n")
    .slice(2)
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.replaceAll("`", "").trim()),
    );
}

const inventory = section("13. Data inventory (source of truth for the privacy policy)");
const storedRows = tableRows(inventory, 0);

describe("the privacy policy matches SPEC.md §13", () => {
  it("has one entry for each row of the stored-data table", () => {
    expect(DATA_INVENTORY.map((entry) => entry.specRow).sort()).toEqual(
      storedRows.map(([name]) => name ?? "").sort(),
    );
  });

  it("states every retention period the table gives", () => {
    for (const [name, , , retention] of storedRows) {
      const entry = DATA_INVENTORY.find((candidate) => candidate.specRow === name);
      const numbers = (retention ?? "").replace(/§\d+/g, "").match(/\d+/g) ?? [];
      for (const number of numbers) {
        expect(entry?.kept, `${String(name)} keeps ${number}`).toMatch(new RegExp(`\\b${number}\\b`));
      }
    }
  });

  it("names a real table for every stored row, and covers every table in the schema", () => {
    const schemaTables = Object.values(schema)
      .filter((value) => is(value, PgTable))
      .map((table) => getTableName(table))
      .sort();
    const inventoryTables = DATA_INVENTORY.flatMap((entry) => (entry.table === null ? [] : [entry.table]));
    expect([...inventoryTables, ...REFERENCE_TABLES].sort()).toEqual(schemaTables);
    for (const entry of DATA_INVENTORY) {
      if (entry.table !== null) expect(entry.table).toBe(entry.specRow);
    }
  });

  it("keeps on the phone exactly what the table says stays there", () => {
    const cell = tableRows(inventory, 1)[0]?.[0] ?? "";
    expect(ON_PHONE.map((item) => item.specItem).sort()).toEqual(
      cell
        .split(",")
        .map((item) => item.trim())
        .sort(),
    );
  });
});

describe("the privacy policy matches SPEC.md §2", () => {
  it("lists every third party that receives data", () => {
    const bullet =
      section("2. Privacy rules")
        .split("\n")
        .find((line) => line.includes("**Third parties that receive data**")) ?? "";
    const named = bullet
      .slice(bullet.indexOf("privacy policy:") + "privacy policy:".length)
      .replace(/\([^)]*\)/g, "")
      .replace(/\s*\.\s*$/, "")
      .split(",")
      .map((part) => part.trim().replace(/^and /, ""))
      .flatMap((part) => part.split(" and "))
      .map((part) => part.trim());
    expect(THIRD_PARTIES.map((party) => party.specName).sort()).toEqual(named.sort());
  });

  it("says suggestion screening keeps nothing", () => {
    const screening = THIRD_PARTIES.find(
      (party) => party.specName === "the AI provider used for suggestion screening",
    );
    expect(screening?.role).toContain("zero data retention");
  });
});

describe("the privacy policy page", () => {
  const text = renderText(<PrivacyPage />);

  it("is marked as a draft pending legal review", () => {
    expect(text).toContain("Draft, pending legal review.");
  });

  it("shows every inventory entry, everything that stays on the phone and every third party", () => {
    for (const entry of DATA_INVENTORY) {
      for (const words of [entry.title, entry.what, entry.linkedTo, entry.kept])
        expect(text).toContain(words);
    }
    for (const item of ON_PHONE) expect(text).toContain(item.text);
    for (const party of THIRD_PARTIES) {
      expect(text).toContain(party.name);
      expect(text).toContain(party.role);
    }
  });

  it("says deleted data can outlive deletion in the database's restore history (spec §9)", () => {
    expect(text).toContain("restore history for up to 30 days");
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run `pnpm --filter web exec vitest run privacy-policy`. Expected: FAIL, because `@/app/(site)/privacy/page` and `@/content/privacy-inventory` don't exist.

- [ ] **Step 3: Implement the retention constants, the inventory and the page.** Create `apps/web/src/server/retention.ts`:

```ts
// Spec §13: how long each kind of stored data lasts. The maintenance cron, the tag counts, the swing check and the
// privacy policy all read these, so the policy can't state one period while the code enforces another.
export const RETENTION = {
  auditDays: 7,
  rateLimitDays: 2,
  suggestionLinkDays: 30,
  inactiveDeviceMonths: 13,
  countWindowDays: 180,
} as const;
```

Create `apps/web/src/content/privacy-inventory.ts`:

```ts
import { RETENTION } from "@/server/retention";

interface InventoryEntry {
  // The row's name in SPEC.md §13's stored-data table, without backticks.
  specRow: string;
  // The table that holds it, or null for data we never store.
  table: string | null;
  title: string;
  what: string;
  linkedTo: string;
  kept: string;
}

// Spec §13 in plain words, one entry per row. The privacy policy renders this, and privacy-policy.test.tsx fails when
// it drifts from SPEC.md or the database schema. Periods come from RETENTION, which the code enforcing them reads.
export const DATA_INVENTORY: readonly InventoryEntry[] = [
  {
    specRow: "devices",
    table: "devices",
    title: "Your phone's record",
    what: "A keyed hash of the app's ID for your phone (never the ID itself), whether it's an iPhone or an Android phone, the first and last day the app contacted us (dates only), whether we've blocked it for spam and, once app checks are switched on, the app's attestation key.",
    linkedTo: "Nothing else. It doesn't mention any meeting.",
    kept: `Until you use “Delete all my tags”, or ${String(RETENTION.inactiveDeviceMonths)} months after the app last contacted us. If we blocked your phone for spam, we keep its hash, platform, dates and blocked flag even after “Delete all my tags”, so the block stays in place. That record still isn't linked to any meeting.`,
  },
  {
    specRow: "tag_submissions",
    table: "tag_submissions",
    title: "Your tags on a meeting",
    what: "The tags you chose for one meeting, whether the app confirmed you were near it (yes or no, never where you were) and the dates. They're stored under an ID made for that meeting alone, so your tags on two meetings can't be connected to each other.",
    linkedTo: "That one meeting.",
    kept: `Until you change or remove them. The counts in the app only include tags confirmed in the last ${String(RETENTION.countWindowDays)} days.`,
  },
  {
    specRow: "tag_counts",
    table: "tag_counts",
    title: "Tag counts",
    what: "For each meeting and tag, how many phones chose it and how many of those were near the meeting.",
    linkedTo: "One meeting.",
    kept: "Rebuilt every time tags change, and every night.",
  },
  {
    specRow: "tag_audit",
    table: "tag_audit",
    title: "Abuse-review log",
    what: "Your phone's hash, a meeting, whether you added or changed tags, and when.",
    linkedTo:
      "Your phone and one meeting. This is the only place we connect a phone to a meeting, so we can find and block spam.",
    kept: `${String(RETENTION.auditDays)} days, then deleted.`,
  },
  {
    specRow: "tag_swings",
    table: "tag_swings",
    title: "Spam flags",
    what: "When one tag suddenly gains many new phones on a meeting: the meeting, the tag, how many new and earlier phones, and when we flagged and reviewed it.",
    linkedTo: "One meeting. No phone.",
    kept: "Kept.",
  },
  {
    specRow: "meeting_aliases",
    table: "meeting_aliases",
    title: "Merged meetings",
    what: "When two listings turn out to be the same meeting, the old meeting ID and the one it became.",
    linkedTo: "Meetings only.",
    kept: "Kept.",
  },
  {
    specRow: "rate_limits",
    table: "rate_limits",
    title: "Daily limits",
    what: "Your phone's hash, which daily limit it counts (new tags or suggestions) and how many you've used.",
    linkedTo: "Your phone only.",
    kept: `${String(RETENTION.rateLimitDays)} days.`,
  },
  {
    specRow: "suggestions",
    table: "suggestions",
    title: "Suggested tags",
    what: "The word or phrase you suggested, and whether we added it, merged it into an existing tag or turned it down. Until we review it, it's also linked to your phone's hash.",
    linkedTo: "Your phone, but only until review.",
    kept: `The text is kept. The link to your phone goes when we review the suggestion or after ${String(RETENTION.suggestionLinkDays)} days, whichever comes first. “Delete all my tags” deletes any suggestion still linked to you.`,
  },
  {
    specRow: "ai_decisions",
    table: "ai_decisions",
    title: "Suggestion screening log",
    what: "The suggested text, what the screening model decided (merge, reject or leave it for a person), its reason, the model's name and the time.",
    linkedTo: `One suggestion, and through it your phone for at most ${String(RETENTION.suggestionLinkDays)} days.`,
    kept: "Kept, including the suggestion's text. “Delete all my tags” deletes it together with a suggestion still linked to you.",
  },
  {
    specRow: "Search request",
    table: null,
    title: "Search location",
    what: "When you search, the app rounds the location to about 1 km (two decimal places) and sends it in the body of the request, never in a web address.",
    linkedTo: "Nothing.",
    kept: "Not stored. It's used for that one search and never written to a log.",
  },
  {
    specRow: "Vercel request logs",
    table: null,
    title: "Hosting request logs",
    what: "Our host, Vercel, records each request's IP address, the page or API path, and the time.",
    linkedTo: "Nothing we control. We never add request contents, headers or locations to these logs.",
    kept: "For the short time Vercel's plan keeps them. We don't copy them anywhere.",
  },
];

// Spec §13's "Stays on the phone" list, in the same order.
export const ON_PHONE: readonly { specItem: string; text: string }[] = [
  { specItem: "exact location", text: "your exact location" },
  { specItem: "search box text", text: "what you type in the search box" },
  { specItem: "recent searches", text: "your recent searches" },
  { specItem: "favorites", text: "your favorite meetings" },
  { specItem: "sobriety date", text: "your sobriety date" },
  { specItem: "local record of tagged meetings", text: "the list of meetings you've tagged" },
  {
    specItem: "attendance-check results",
    text: "your near-the-meeting check results (only a yes or no is sent, with your tags)",
  },
  { specItem: "cached meetings", text: "meetings saved for use offline" },
  {
    specItem: "all later-phase personal features",
    text: "anything you add in later features, such as notes, a meeting log or a journal",
  },
];

// Spec §2's list of third parties that receive data. specName is the name as SPEC.md writes it.
export const THIRD_PARTIES: readonly { specName: string; name: string; role: string }[] = [
  {
    specName: "Vercel",
    name: "Vercel",
    role: "Hosts this website and the app's server, so it receives every request, including your IP address, and keeps short-term request logs.",
  },
  {
    specName: "Neon",
    name: "Neon",
    role: "Hosts our database, which holds everything listed above, and keeps its restore history.",
  },
  {
    specName: "Apple",
    name: "Apple",
    role: "On iPhone, Apple Maps draws the map and gives directions, Apple's geocoder turns a place you type into a map point, and, once switched on, App Attest and DeviceCheck confirm that requests come from the real app.",
  },
  {
    specName: "Google",
    name: "Google",
    role: "On Android, Google Maps draws the map and gives directions, Android's geocoder turns a place you type into a map point, and, once switched on, Play Integrity confirms that requests come from the real app.",
  },
  {
    specName: "the AI provider used for suggestion screening",
    name: "Suggestion screening",
    role: "When you suggest a new tag, only its text (never your phone's ID or location) goes through Vercel's AI Gateway to a screening model, currently OpenAI's gpt-5-nano, with zero data retention: the provider doesn't keep it or train on it.",
  },
];
```

Create `apps/web/src/components/draft-notice.tsx`:

```tsx
// Owner decision: the legal pages stay marked as drafts until the spec §16 legal review.
export function DraftNotice() {
  return (
    <p className="draft-notice" role="note">
      <strong>Draft, pending legal review.</strong> This text hasn&apos;t been reviewed by a lawyer yet and
      may change before the app launches.
    </p>
  );
}
```

Create `apps/web/src/app/(site)/privacy/page.tsx`:

```tsx
import { BRAND } from "@mymeetingapp/shared";

import { DraftNotice } from "@/components/draft-notice";
import { DATA_INVENTORY, ON_PHONE, THIRD_PARTIES } from "@/content/privacy-inventory";
import { pageMetadata } from "@/lib/page-metadata";
import { RETENTION } from "@/server/retention";

export const metadata = pageMetadata({
  path: "/privacy",
  title: "Privacy policy",
  description: "Everything mymeetingapp stores, why, for how long, and who else receives it.",
});

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <DraftNotice />
      <p>
        {BRAND.appName} is made by {BRAND.publisher}, a Tennessee company. This policy covers the app for
        iPhone and Android and this website. It lists everything our server stores. Nothing is left out.
      </p>

      <h2>In short</h2>
      <ul>
        <li>No accounts. We never ask for your name, email or phone number.</li>
        <li>We know your phone only by a keyed hash of the app&apos;s ID for it, never the ID itself.</li>
        <li>
          Your tags on each meeting are stored under an ID made for that meeting alone, so we can&apos;t list
          the meetings one phone has tagged, except in a {RETENTION.auditDays}-day abuse-review log.
        </li>
        <li>No ads, analytics, tracking or cookies, in the app or on this website.</li>
      </ul>

      <h2>What stays on your phone</h2>
      <p>These never leave your phone:</p>
      <ul>
        {ON_PHONE.map((item) => (
          <li key={item.specItem}>{item.text}</li>
        ))}
      </ul>

      <h2>What our server stores</h2>
      {DATA_INVENTORY.map((entry) => (
        <section key={entry.specRow}>
          <h3>{entry.title}</h3>
          <dl>
            <dt>What</dt>
            <dd>{entry.what}</dd>
            <dt>Linked to</dt>
            <dd>{entry.linkedTo}</dd>
            <dt>How long</dt>
            <dd>{entry.kept}</dd>
          </dl>
        </section>
      ))}

      <h2>Meeting listings</h2>
      <p>
        Meeting times and places come from meeting lists that AA intergroups and other service entities
        publish. We keep only the meeting details (name, time, place, format and online links), never the
        contact names, emails or phone numbers some lists include. We look up missing map locations with the
        US Census Bureau&apos;s geocoder, sending it only the meeting&apos;s address.
      </p>

      <h2>Who else receives data</h2>
      <dl>
        {THIRD_PARTIES.map((party) => (
          <div key={party.specName}>
            <dt>{party.name}</dt>
            <dd>{party.role}</dd>
          </div>
        ))}
      </dl>
      <p>
        When you type a place into the app&apos;s search box, your phone asks Apple or Google to find it. We
        never receive what you typed, only the rounded point.
      </p>

      <h2>Backups</h2>
      <p>
        Deleted data can remain in our database provider&apos;s restore history for up to 30 days, and then
        it&apos;s gone. We use that history only to recover from a failure.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          Change or remove your tags on any meeting at any time, from the meeting&apos;s page in the app.
        </li>
        <li>
          “Delete all my tags” in the app&apos;s Settings deletes every tag, daily limit, abuse-log entry and
          phone record we hold for your phone, and any suggestion we haven&apos;t reviewed yet with its
          screening log. Tag counts update at once. A phone we blocked for spam keeps its blocked record.
        </li>
        <li>Location permission is optional. Without it, search by city, zip code or address.</li>
      </ul>

      <h2>Children</h2>
      <p>
        The app isn&apos;t meant for children under 13, and we don&apos;t knowingly collect anything from
        them. We collect nothing that identifies anyone.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We&apos;ll post any change here with a new date. Questions go to{" "}
        <a href={`mailto:${BRAND.contactEmail}`}>{BRAND.contactEmail}</a>.
      </p>
      <p className="fine-print">Draft of 29 September 2026.</p>
    </>
  );
}
```

- [ ] **Step 4: Run it and watch it pass.** Run `pnpm --filter web exec vitest run privacy-policy`. Expected: PASS.

- [ ] **Step 5: Refactor: the code that enforces each period reads `RETENTION`.** Add `import { RETENTION } from "@/server/retention";` to each file, then make these replacements:
  - In `apps/web/src/server/maintenance.ts`:
    - ``lt(tagAudit.at, sql`now() - interval '7 days'`)`` → ``lt(tagAudit.at, sql`now() - make_interval(days => ${RETENTION.auditDays}::int)`)``
    - ``lt(rateLimits.windowStart, sql`${utcToday} - 1`)`` → ``lt(rateLimits.windowStart, sql`${utcToday} - ${RETENTION.rateLimitDays - 1}::int`)``
    - ``lt(suggestions.createdAt, sql`now() - interval '30 days'`)`` → ``lt(suggestions.createdAt, sql`now() - make_interval(days => ${RETENTION.suggestionLinkDays}::int)`)``
    - ``lt(devices.lastSeenDate, sql`(${utcToday} - interval '13 months')::date`)`` → ``lt(devices.lastSeenDate, sql`(${utcToday} - make_interval(months => ${RETENTION.inactiveDeviceMonths}::int))::date`)``
  - In `apps/web/src/server/tags/counts.ts`, inside `insertCounts`: `s.confirmed_at > now() - interval '180 days'` → `s.confirmed_at > now() - make_interval(days => ${RETENTION.countWindowDays}::int)`.
  - In `apps/web/src/server/tags/swings.ts`: `confirmed_at > now() - interval '180 days'` → `confirmed_at > now() - make_interval(days => ${RETENTION.countWindowDays}::int)`.

  Then run `grep -rn "interval '7 days'\|interval '30 days'\|13 months\|interval '180 days'" apps/web/src`. Expected: only tagging rules and schedules, not retention periods: `own-submissions.ts` (`confirmedThisWeek`, the 7-day re-confirmation rule), `window.ts` (the previous week's occurrence) and `run-sync.ts` (`SUCCESS_INTERVAL`, the weekly sync).

- [ ] **Step 6: Run the tests.** Run `pnpm --filter web exec vitest run maintenance recompute tag-swings tags-route privacy-policy`, then `pnpm check`. Expected: PASS. The maintenance tests pin each boundary, so they prove the refactor changed nothing.

- [ ] **Step 7: Commit.**

```bash
git add apps/web/src apps/web/test/privacy-policy.test.tsx
git commit -m "feat(site): privacy policy generated from the data inventory, checked against SPEC.md and the schema"
```

---

### Task 4: Terms of use and the support page

**Files:**

- Create: `apps/web/src/app/(site)/terms/page.tsx`, `apps/web/src/app/(site)/support/page.tsx`, `apps/web/test/terms-and-support.test.tsx`

**Interfaces:**

- Consumes: `pageMetadata`, `renderText` (Task 1), `DraftNotice` (Task 3), `HelpResources` (Task 2), `BRAND.contactEmail`.

- [ ] **Step 1: Write the failing test.** Create `apps/web/test/terms-and-support.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SupportPage from "@/app/(site)/support/page";
import TermsPage from "@/app/(site)/terms/page";

import { renderText } from "./render";

describe("the terms of use", () => {
  const text = renderText(<TermsPage />);

  it.each([
    "Draft, pending legal review.",
    "not affiliated with, endorsed by or approved by Alcoholics Anonymous or A.A. World Services, Inc.",
    "Listings can be out of date",
    "isn't medical advice",
    "governed by the laws of the State of Tennessee",
  ])("say %j (spec §9)", (words) => {
    expect(text).toContain(words);
  });
});

describe("the support page", () => {
  const text = renderText(<SupportPage />);

  it("gives the contact email as a link", () => {
    expect(renderToStaticMarkup(<SupportPage />)).toContain('href="mailto:admin@goodersoftwarellc.com"');
  });

  it("explains how an intergroup or other service entity stops the app using its list", () => {
    expect(text).toContain("For intergroups and other service entities");
    expect(text).toContain("we'll stop using it");
  });

  it("explains how a group turns tags off", () => {
    expect(text).toContain("For groups");
    expect(text).toContain("We'll turn tags off for it");
  });

  it("lists crisis help", () => {
    expect(text).toContain("call or text 988");
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run `pnpm --filter web exec vitest run terms-and-support`. Expected: FAIL, because the pages don't exist.

- [ ] **Step 3: Implement.** Create `apps/web/src/app/(site)/terms/page.tsx`:

```tsx
import { BRAND } from "@mymeetingapp/shared";

import { DraftNotice } from "@/components/draft-notice";
import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  path: "/terms",
  title: "Terms of use",
  description: "The terms for using the mymeetingapp app and website.",
});

export default function TermsPage() {
  return (
    <>
      <h1>Terms of use</h1>
      <DraftNotice />
      <p>
        These terms cover the {BRAND.appName} app and this website, made by {BRAND.publisher} (“we”). By using
        them, you agree to these terms.
      </p>

      <h2>Not affiliated with AA</h2>
      <p>
        {BRAND.appName} is an independent app. It is not affiliated with, endorsed by or approved by
        Alcoholics Anonymous or A.A. World Services, Inc. We use “AA” only to describe the meetings listed.
      </p>

      <h2>Listings can be out of date</h2>
      <p>
        Meeting listings come from lists that intergroups and other AA service entities publish. They change
        often, and we can&apos;t check them. A meeting may have moved, changed its time or stopped meeting.
        When it matters, check with the group or the local intergroup.
      </p>

      <h2>Not medical advice</h2>
      <p>
        The app helps you find meetings. It isn&apos;t medical advice, treatment or a crisis service. If you
        are in crisis, call or text 988, or call the SAMHSA National Helpline at 1-800-662-4357.
      </p>

      <h2>Tags and suggestions</h2>
      <p>
        Tags come from a fixed list and describe a meeting, not people. Don&apos;t use tags or suggestions to
        harass, advertise or mislead. We may block phones that send spam, which stops their tags from
        counting.
      </p>

      <h2>The app is provided as it is</h2>
      <p>
        The app is free and provided “as is”, without warranties of any kind. As far as the law allows, we
        aren&apos;t liable for any loss that comes from using it or from a listing being wrong.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the State of Tennessee, and any dispute will be heard in the
        courts of Tennessee.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We&apos;ll post any change here with a new date. Questions go to{" "}
        <a href={`mailto:${BRAND.contactEmail}`}>{BRAND.contactEmail}</a>.
      </p>
      <p className="fine-print">Draft of 29 September 2026.</p>
    </>
  );
}
```

Create `apps/web/src/app/(site)/support/page.tsx`:

```tsx
import { BRAND } from "@mymeetingapp/shared";

import { HelpResources } from "@/components/help-resources";
import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  path: "/support",
  title: "Support",
  description: "Help with mymeetingapp, and how intergroups and groups can opt out.",
});

export default function SupportPage() {
  const email = <a href={`mailto:${BRAND.contactEmail}`}>{BRAND.contactEmail}</a>;
  return (
    <>
      <h1>Support</h1>
      <p>
        Email {email}. We read every message. If your question is about your tags, include the app ID shown in
        the app&apos;s Settings.
      </p>

      <h2>Common questions</h2>
      <h3>How do I remove my tags?</h3>
      <p>
        Open the meeting and choose “Remove my tags”, or remove all of them at once in Settings with “Delete
        all my tags”. Both work at any time.
      </p>
      <h3>Why can&apos;t I tag a meeting?</h3>
      <p>
        New tags can be added from the start of a meeting until 36 hours later, once per meeting every 7 days.
        You can change your tags at any time.
      </p>
      <h3>A meeting&apos;s details are wrong</h3>
      <p>
        Listings come from the local intergroup or service entity. Please let them know. The app picks up
        their changes within about a week.
      </p>
      <h3>Does the app know who I am?</h3>
      <p>
        No. There are no accounts, and your location and personal details stay on your phone. The{" "}
        <a href="/privacy">privacy policy</a> lists everything we store.
      </p>

      <h2>Opting out</h2>
      <h3>For intergroups and other service entities</h3>
      <p>
        If you publish a meeting list and don&apos;t want {BRAND.appName} to use it, email {email} with your
        website or list address, and we&apos;ll stop using it. Its meetings leave the app within a few days of
        your email. You never need to give a reason.
      </p>
      <h3>For groups</h3>
      <p>
        If your group doesn&apos;t want to be tagged, email {email} with the meeting&apos;s name, day, time
        and address. We&apos;ll turn tags off for it: the app stops accepting tags for that meeting and
        doesn&apos;t show any.
      </p>

      <HelpResources />
    </>
  );
}
```

- [ ] **Step 4: Run the tests.** Run `pnpm --filter web exec vitest run terms-and-support`, then `pnpm check`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/app apps/web/test/terms-and-support.test.tsx
git commit -m "feat(site): terms of use and support page with opt-out instructions"
```

---

### Task 5: robots.txt, sitemap, canonical links and Open Graph

**Files:**

- Create: `apps/web/src/app/robots.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/test/seo.test.ts`
- Modify: `apps/web/test/site.e2e.ts`

**Interfaces:**

- Consumes: `siteUrl()` and the four public pages' `pageMetadata` (Tasks 1–4).

- [ ] **Step 1: Write the failing tests.** Create `apps/web/test/seo.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

describe("robots.txt", () => {
  it("keeps crawlers out of /metrics and the API, and names the sitemap (spec §9)", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/metrics", "/api/"] },
      sitemap: "https://mymeetingapp.test/sitemap.xml",
    });
  });
});

describe("the sitemap", () => {
  it("lists the four public pages at the site URL", () => {
    expect(sitemap()).toEqual([
      { url: "https://mymeetingapp.test/" },
      { url: "https://mymeetingapp.test/privacy" },
      { url: "https://mymeetingapp.test/terms" },
      { url: "https://mymeetingapp.test/support" },
    ]);
  });
});
```

Add this to `apps/web/test/site.e2e.ts`:

```ts
describe("search engine files and links", () => {
  it("serves robots.txt and the sitemap built with SITE_URL", async () => {
    const robotsTxt = await (await fetch(`${E2E_URL}/robots.txt`)).text();
    expect(robotsTxt).toContain("Disallow: /metrics");
    expect(robotsTxt).toContain("Disallow: /api/");
    expect(robotsTxt).toContain("Sitemap: https://mymeetingapp.test/sitemap.xml");
    const sitemapXml = await (await fetch(`${E2E_URL}/sitemap.xml`)).text();
    expect(sitemapXml).toContain("<loc>https://mymeetingapp.test/privacy</loc>");
  });

  it.each(["/", "/privacy", "/terms", "/support"])(
    "gives %s its canonical link and Open Graph URL",
    async (path) => {
      const html = await (await fetch(`${E2E_URL}${path}`)).text();
      const url = `https://mymeetingapp.test${path === "/" ? "" : path}`;
      expect(html).toContain(`<link rel="canonical" href="${url}"/>`);
      expect(html).toContain(`<meta property="og:url" content="${url}"/>`);
      expect(html).toContain('<meta property="og:site_name" content="mymeetingapp"/>');
    },
  );
});
```

(Next.js writes the home page's canonical link without a trailing slash.)

- [ ] **Step 2: Run them and watch them fail.** Run `pnpm --filter web exec vitest run seo`. Expected: FAIL, because `@/app/robots` doesn't exist.

- [ ] **Step 3: Implement.** Create `apps/web/src/app/robots.ts`:

```ts
import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

// Spec §9. Built once at build time from SITE_URL.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/metrics", "/api/"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
```

Create `apps/web/src/app/sitemap.ts`:

```ts
import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

const PUBLIC_PAGES = ["/", "/privacy", "/terms", "/support"];

// No lastModified: the pages carry no real date to give.
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((path) => ({ url: new URL(path, siteUrl()).href }));
}
```

- [ ] **Step 4: Run the tests.** Run `pnpm --filter web exec vitest run seo`, then `pnpm check`, then `pnpm --filter web test:e2e`. Expected: PASS. The build lists `/robots.txt` and `/sitemap.xml` as static. If the home page's canonical link comes out as `https://mymeetingapp.test/` in your Next version, change the test's `url` for `/` to match what Next writes. Both forms are correct.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/app/robots.ts apps/web/src/app/sitemap.ts apps/web/test/seo.test.ts apps/web/test/site.e2e.ts
git commit -m "feat(site): robots.txt, sitemap, and canonical and Open Graph links from SITE_URL"
```

---

### Task 6: Signing in to `/metrics` in `proxy.ts`

Next.js 16 renamed middleware to proxy. `proxy.ts` sits next to `app` (so `apps/web/src/proxy.ts`), exports `proxy(request)` and a `config.matcher`, and runs on the Node.js runtime by default. Setting `runtime` there is an error. See `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`. Server Actions are POSTs to the page that holds them, so the `/metrics/:path*` matcher covers every admin action as well.

**Files:**

- Create:
  - `apps/web/src/proxy.ts`, `apps/web/src/lib/constant-time.ts`, `apps/web/src/lib/admin-auth.ts`
  - `apps/web/src/server/admin/login-guard.ts`
  - `apps/web/drizzle/0013_lock-timeout-admin.sql` (custom), `apps/web/drizzle/0014_metrics-login-limit.sql` (generated)
  - `apps/web/test/proxy.test.ts`, `apps/web/test/metrics-auth.e2e.ts`
- Modify:
  - `apps/web/src/lib/api/cron-auth.ts`, `apps/web/src/server/devices/rate-limit.ts`, `apps/web/src/db/schema/tagging.ts`
  - `apps/web/src/env.ts`, `apps/web/.env.example`, `apps/web/test/e2e-server.ts`
  - `apps/web/src/content/privacy-inventory.ts`, `eslint.config.js`, `SPEC.md` (§10, §13), `docs/standards.md`

**Interfaces:**

- Consumes: `consumeDailyLimit`, `rateLimits`, `utcToday`, `readEnv`, `E2E_URL` (Task 1).
- Produces:
  - `constantTimeEqual(a: string, b: string): boolean` from `@/lib/constant-time`.
  - `isAdminAuthorization(header: string | null): boolean` from `@/lib/admin-auth`. Task 8's `adminAction` calls it again inside every Server Action.
  - `dailyLimitReached(key: string, bucket: RateLimitBucket, executor: Executor): Promise<boolean>` from `@/server/devices/rate-limit`.
  - `checkAdminLogin(authorization: string | null): Promise<"allowed" | "denied" | "locked">` from `@/server/admin/login-guard`.
  - `proxy(request: NextRequest): Promise<Response>` and `config` from `src/proxy.ts`.
  - `ADMIN_AUTHORIZATION` (the Basic header for the e2e server's admin credentials) from `test/e2e-server.ts`.

- [ ] **Step 1: Write the failing tests.** Create `apps/web/test/proxy.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db, pool } from "@/db/client";
import { rateLimits } from "@/db/schema";
import { proxy } from "@/proxy";

import { resetDb } from "./db";

// base64("owner:correct-horse-battery-staple"), base64("owner:wrong-password-guess-123") and base64("owner:short"),
// computed independently.
const OWNER = "Basic b3duZXI6Y29ycmVjdC1ob3JzZS1iYXR0ZXJ5LXN0YXBsZQ==";
const WRONG = "Basic b3duZXI6d3JvbmctcGFzc3dvcmQtZ3Vlc3MtMTIz";
const SHORT = "Basic b3duZXI6c2hvcnQ=";
const SITE = "https://mymeetingapp.test";
const CHALLENGE = 'Basic realm="mymeetingapp admin", charset="UTF-8"';

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("METRICS_USER", "owner");
  vi.stubEnv("METRICS_PASSWORD", "correct-horse-battery-staple");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => pool.end());

function request(init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`${SITE}/metrics`, {
    method: init.method ?? "GET",
    headers: { host: "mymeetingapp.test", ...init.headers },
  });
}

async function failedSignIns(): Promise<number> {
  const rows = await db
    .select({ count: rateLimits.count })
    .from(rateLimits)
    .where(eq(rateLimits.bucket, "metrics_login"));
  return rows.reduce((sum, row) => sum + row.count, 0);
}

// NextResponse.next() marks a response that lets the request continue to the page.
const passesThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy for /metrics (spec §10)", () => {
  it("asks for credentials without counting that as a failed sign-in", async () => {
    const res = await proxy(request());
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(CHALLENGE);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await failedSignIns()).toBe(0);
  });

  it("lets the owner through, marked never to be cached or indexed", async () => {
    const res = await proxy(request({ headers: { authorization: OWNER } }));
    expect(passesThrough(res)).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it.each([WRONG, "Basic", `Bearer ${OWNER.slice("Basic ".length)}`])(
    "refuses %j and counts it as a failed sign-in",
    async (authorization) => {
      const res = await proxy(request({ headers: { authorization } }));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe(CHALLENGE);
      expect(await failedSignIns()).toBe(1);
    },
  );

  it("still lets the owner in after 19 failed sign-ins", async () => {
    for (let n = 0; n < 19; n++) await proxy(request({ headers: { authorization: WRONG } }));
    expect(passesThrough(await proxy(request({ headers: { authorization: OWNER } })))).toBe(true);
  });

  it("refuses everyone, the owner included, once 20 sign-ins have failed today", async () => {
    for (let n = 0; n < 20; n++) {
      expect((await proxy(request({ headers: { authorization: WRONG } }))).status).toBe(401);
    }
    const res = await proxy(request({ headers: { authorization: OWNER } }));
    expect(res.status).toBe(429);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await failedSignIns()).toBe(20);
  });

  it("refuses everyone while the password is unset or shorter than 16 characters", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("METRICS_PASSWORD", "short");
    expect((await proxy(request({ headers: { authorization: SHORT } }))).status).toBe(401);
    vi.stubEnv("METRICS_PASSWORD", undefined);
    expect((await proxy(request({ headers: { authorization: OWNER } }))).status).toBe(401);
    expect(warn).toHaveBeenCalledWith(
      "[admin] METRICS_USER and METRICS_PASSWORD (at least 16 characters) must be set; refusing every sign-in",
    );
  });

  it("refuses a post from another site, with no Origin or with a null one, before checking credentials", async () => {
    for (const headers of [
      { authorization: OWNER, origin: "https://evil.example" },
      { authorization: OWNER },
      { authorization: OWNER, origin: "null" },
    ]) {
      const res = await proxy(request({ method: "POST", headers }));
      expect(res.status).toBe(403);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(await failedSignIns()).toBe(0);
  });

  it("lets the owner's own form post (a Server Action) through", async () => {
    const res = await proxy(request({ method: "POST", headers: { authorization: OWNER, origin: SITE } }));
    expect(passesThrough(res)).toBe(true);
  });

  it("compares the Origin with the forwarded host Vercel sets", async () => {
    const res = await proxy(
      request({
        method: "POST",
        headers: {
          authorization: OWNER,
          origin: "https://mymeetingapp.vercel.app",
          "x-forwarded-host": "mymeetingapp.vercel.app",
        },
      }),
    );
    expect(passesThrough(res)).toBe(true);
  });
});
```

In `apps/web/test/e2e-server.ts`, add these below `E2E_URL`:

```ts
// The server's admin credentials. The password is at least 16 characters, as isAdminAuthorization requires.
const E2E_ADMIN = { user: "e2e-admin", password: "e2e-password-not-a-secret-0123" };
export const ADMIN_AUTHORIZATION = `Basic ${Buffer.from(`${E2E_ADMIN.user}:${E2E_ADMIN.password}`).toString("base64")}`;
```

In `setup`, change the spawned server's `env` to:

```ts
      env: {
        ...process.env,
        ...project.config.env,
        METRICS_USER: E2E_ADMIN.user,
        METRICS_PASSWORD: E2E_ADMIN.password,
        NODE_ENV: "production",
      },
```

Create `apps/web/test/metrics-auth.e2e.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ADMIN_AUTHORIZATION, E2E_URL } from "./e2e-server";

describe("/metrics sign-in in the built app (spec §14)", () => {
  it.each(["/metrics", "/metrics/suggestions", "/metrics/swings/1"])(
    "answers %s with 401 without credentials, never cached or indexed",
    async (path) => {
      const res = await fetch(`${E2E_URL}${path}`, { redirect: "manual" });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe('Basic realm="mymeetingapp admin", charset="UTF-8"');
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    },
  );

  it("never serves /metrics/ with a trailing slash to someone without credentials", async () => {
    const res = await fetch(`${E2E_URL}/metrics/`, { redirect: "manual" });
    expect([308, 401]).toContain(res.status);
  });

  it("refuses a form post from another site even with the right credentials", async () => {
    const res = await fetch(`${E2E_URL}/metrics`, {
      method: "POST",
      redirect: "manual",
      headers: { authorization: ADMIN_AUTHORIZATION, origin: "https://evil.example" },
      body: new FormData(),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `pnpm --filter web exec vitest run proxy`. Expected: FAIL, because `@/proxy` doesn't exist. Run `pnpm --filter web test:e2e`. Expected: `metrics-auth.e2e.ts` FAILS (404 instead of 401).

- [ ] **Step 3: Compare secrets in one place.** In `apps/web/src/env.ts`, add `| "METRICS_USER"` and `| "METRICS_PASSWORD"` to `EnvName`. Create `apps/web/src/lib/constant-time.ts`:

```ts
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

// Compares two secrets in constant time whatever their lengths: both are hashed to 32 bytes first.
export function constantTimeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}
```

Replace `apps/web/src/lib/api/cron-auth.ts` with:

```ts
import { readEnv } from "@/env";
import { ApiError } from "@/lib/api/respond";
import { constantTimeEqual } from "@/lib/constant-time";

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without a configured secret, nothing gets in.
export function assertCronRequest(req: Request): void {
  const secret = readEnv("CRON_SECRET");
  const header = req.headers.get("authorization") ?? "";
  if (secret === undefined || !constantTimeEqual(header, `Bearer ${secret}`)) {
    throw new ApiError("unauthorized");
  }
}
```

Create `apps/web/src/lib/admin-auth.ts`:

```ts
import { readEnv } from "@/env";
import { constantTimeEqual } from "@/lib/constant-time";

const MIN_PASSWORD_LENGTH = 16;

// Spec §10: METRICS_USER and METRICS_PASSWORD (sensitive Vercel variables) guard /metrics with HTTP Basic Auth.
// Without both, or with a short password, nobody gets in.
export function isAdminAuthorization(header: string | null): boolean {
  const user = readEnv("METRICS_USER");
  const password = readEnv("METRICS_PASSWORD");
  if (user === undefined || password === undefined || password.length < MIN_PASSWORD_LENGTH) {
    console.warn(
      `[admin] METRICS_USER and METRICS_PASSWORD (at least ${String(MIN_PASSWORD_LENGTH)} characters) must be set; refusing every sign-in`,
    );
    return false;
  }
  const expected = `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
  return header !== null && constantTimeEqual(header, expected);
}
```

- [ ] **Step 4: Count failed sign-ins in `rate_limits`.**
  1. Run `pnpm --filter web exec drizzle-kit generate --custom --name lock-timeout-admin` and put this in the new `apps/web/drizzle/0013_lock-timeout-admin.sql`:

     ```sql
     SET LOCAL lock_timeout = '10s';
     ```

     This is the same guard Phases 2 and 3 used. Drizzle applies every pending migration in one transaction, so this covers the phase's schema changes.

  2. In `apps/web/src/db/schema/tagging.ts`, change the buckets and the table comment:

     ```ts
     const RATE_LIMIT_BUCKETS = ["tag_submission", "suggestion", "metrics_login"] as const;
     export type RateLimitBucket = (typeof RATE_LIMIT_BUCKETS)[number];

     // Spec §5: per device per UTC day, with no meeting id. Kept two days. metrics_login is one site-wide count of
     // failed /metrics sign-ins (spec §10) under the key "metrics-login": no device, IP address or username.
     ```

  3. Run `pnpm --filter web db:generate --name metrics-login-limit`. Expected: `apps/web/drizzle/0014_metrics-login-limit.sql` holds exactly:

     ```sql
     ALTER TABLE "rate_limits" DROP CONSTRAINT "rate_limits_bucket_check";--> statement-breakpoint
     ALTER TABLE "rate_limits" ADD CONSTRAINT "rate_limits_bucket_check" CHECK ("rate_limits"."bucket" in ('tag_submission', 'suggestion', 'metrics_login'));
     ```

  4. In `apps/web/src/server/devices/rate-limit.ts`:
     - Change the import to `import { and, eq, sql } from "drizzle-orm";`.
     - Rename `consumeDailyLimit`'s first parameter from `deviceHash` to `key` (in its `values (...)` too), and add `// key is a device hash, or "metrics-login" for the site-wide sign-in count.` above its existing comment.
     - Change the limits to:

       ```ts
       const DAILY_LIMITS: Record<RateLimitBucket, number> = {
         tag_submission: 10,
         suggestion: 5,
         metrics_login: 20,
       };
       ```

     - Add:

       ```ts
       // Whether today's allowance is already used up, without using any of it. For a caller that must refuse before
       // doing the work a failure would count: admin sign-in compares credentials only while under the limit.
       export async function dailyLimitReached(
         key: string,
         bucket: RateLimitBucket,
         executor: Executor,
       ): Promise<boolean> {
         const [row] = await executor
           .select({ count: rateLimits.count })
           .from(rateLimits)
           .where(
             and(
               eq(rateLimits.deviceHash, key),
               eq(rateLimits.bucket, bucket),
               eq(rateLimits.windowStart, utcToday),
             ),
           );
         return (row?.count ?? 0) >= DAILY_LIMITS[bucket];
       }
       ```

  5. Create `apps/web/src/server/admin/login-guard.ts`:

     ```ts
     import { db } from "@/db/client";
     import { isAdminAuthorization } from "@/lib/admin-auth";
     import { ApiError } from "@/lib/api/respond";
     import { consumeDailyLimit, dailyLimitReached } from "@/server/devices/rate-limit";

     // One site-wide count (owner decision 2): a sign-in attempt stores no device, IP address or username (spec §2).
     const LOGIN_KEY = "metrics-login";

     // Spec §10. A browser's first request carries no credentials; it gets the sign-in prompt and isn't a failure.
     // Once today's failures reach the limit, every attempt is refused before the credentials are compared, the
     // right ones included, so guessing can't go on.
     export async function checkAdminLogin(
       authorization: string | null,
     ): Promise<"allowed" | "denied" | "locked"> {
       if (authorization === null) return "denied";
       if (await dailyLimitReached(LOGIN_KEY, "metrics_login", db)) return "locked";
       if (isAdminAuthorization(authorization)) return "allowed";
       try {
         await consumeDailyLimit(LOGIN_KEY, "metrics_login", db);
       } catch (error) {
         if (error instanceof ApiError) return "locked";
         throw error;
       }
       return "denied";
     }
     ```

- [ ] **Step 5: Write the proxy.** Create `apps/web/src/proxy.ts`:

```ts
import { type NextRequest, NextResponse } from "next/server";

import { checkAdminLogin } from "@/server/admin/login-guard";

// Spec §10: nothing under /metrics is ever cached or indexed, whatever the answer.
const PRIVATE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const CHALLENGE = 'Basic realm="mymeetingapp admin", charset="UTF-8"';

// Browsers attach Basic credentials to any request for this site, even one another site triggers, so anything but
// a read must come from a page on this host. Next.js checks Server Actions the same way, but logs the mismatched
// header values when it refuses one; refusing here first keeps them out of the logs (spec §2).
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin === null || host === null) return false;
  return URL.parse(origin)?.host === host;
}

// Spec §10: HTTP Basic Auth for /metrics and its admin views, with failed sign-ins limited in Postgres. Nothing
// about a request is logged. Vercel serves only HTTPS, so the credentials never travel in the clear.
export async function proxy(request: NextRequest): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) {
    return new Response("Requests from other sites aren't allowed here.", { status: 403, headers: PRIVATE });
  }
  switch (await checkAdminLogin(request.headers.get("authorization"))) {
    case "allowed":
      return NextResponse.next({ headers: PRIVATE });
    case "locked":
      return new Response("Too many failed sign-ins today. Try again after midnight UTC.", {
        status: 429,
        headers: PRIVATE,
      });
    case "denied":
      return new Response("Sign in to see the metrics.", {
        status: 401,
        headers: { ...PRIVATE, "WWW-Authenticate": CHALLENGE },
      });
  }
}

export const config = { matcher: ["/metrics", "/metrics/:path*"] };
```

In `eslint.config.js`:

- In the block for `apps/web/**/*.{ts,tsx}`, change `ignores` to `["apps/web/src/lib/api/respond.ts", "apps/web/src/proxy.ts"]`.
- In the block after it, change `files` to `["apps/web/src/lib/api/respond.ts", "apps/web/src/proxy.ts"]` and add a comment above it: `// respond.ts is the one JSON sender; proxy.ts lets allowed requests through with NextResponse.next().`

- [ ] **Step 6: Run the tests and watch them pass.** Run `pnpm --filter web exec vitest run proxy sync-route maintenance`, then `pnpm --filter web test:e2e`. Expected: PASS. The sync-route tests prove the cron check still works on `constantTimeEqual`. If `next build` fails to bundle `pg` into the proxy (for example "Can't resolve 'pg-native'"), add `serverExternalPackages: ["pg"]` to `apps/web/next.config.ts` and build again.

- [ ] **Step 7: Record the limit in the spec, the policy and the standards.**
  1. In `SPEC.md` §13, change the `rate_limits` row's contents cell to `device hash, bucket, count (plus one site-wide count of failed /metrics sign-ins, with no device)`, then run `pnpm format`.
  2. In §10's first bullet, append: "Failed logins are counted in `rate_limits` under one site-wide `metrics_login` bucket. After 20 in a UTC day, every sign-in is refused until the next day. No IP address or device is stored."
  3. In `apps/web/src/content/privacy-inventory.ts`, change the `rate_limits` entry's `what` to: `"Your phone's hash, which daily limit it counts (new tags or suggestions) and how many you've used. A separate count of failed sign-ins to our admin page covers the whole site and names no phone."`
  4. In `apps/web/.env.example`, add `METRICS_USER=owner` and `METRICS_PASSWORD=local-metrics-password-0123`.
  5. In `docs/standards.md`, change the Rate limits row's "The one way" cell to: "`consumeDailyLimit(key, bucket, tx)` from `@/server/devices/rate-limit`, after every other check, inside the write's transaction. Admin sign-in checks `dailyLimitReached` first and consumes only on a failure (`checkAdminLogin`)". Then add these rows:

     | Concern                   | The one way                                                                                                                                                                                                                                                               | Enforced by                                  |
     | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
     | Comparing secrets         | `constantTimeEqual(a, b)` from `@/lib/constant-time`                                                                                                                                                                                                                      | review                                       |
     | Admin access (`/metrics`) | `src/proxy.ts`. It refuses anything but GET/HEAD from another origin, checks `checkAdminLogin` (Basic Auth plus the `metrics_login` limit), and sends `no-store` and `noindex` on every response. It is the only file besides `respond.ts` that may import `NextResponse` | lint, `proxy.test.ts`, `metrics-auth.e2e.ts` |

  6. Run `pnpm check`. Expected: PASS. The privacy policy test still passes, since the `rate_limits` retention is unchanged.

- [ ] **Step 8: Commit.**

```bash
git add apps/web eslint.config.js SPEC.md docs/standards.md
git commit -m "feat(admin): Basic Auth for /metrics in proxy.ts, with a same-origin check and a sign-in limit"
```

---

### Task 7: The `/metrics` overview: totals and feed health

**Files:**

- Create:
  - `apps/web/src/server/admin/metrics.ts`
  - `apps/web/src/app/metrics/layout.tsx`, `apps/web/src/app/metrics/page.tsx`, `apps/web/src/app/metrics/format.ts`
  - `apps/web/test/admin-metrics.test.ts`, `apps/web/test/e2e-forms.ts`, `apps/web/test/metrics.e2e.ts`
- Modify: `apps/web/src/server/sync/run-sync.ts`, `SPEC.md` (§10)

**Interfaces:**

- Consumes: `utcToday`, the schema tables, `ADMIN_AUTHORIZATION` and `E2E_URL` (Tasks 1 and 6), and the test fixtures `seedMeetingStarted`, `elsewhere`, `insertSubmission`, `seedFeed`, `deviceHeaders` and `DEVICE_A_HASH`.
- Produces:
  - `readMetrics(): Promise<Metrics>` and `readFeedsNeedingAttention(): Promise<FeedAttention[]>` from `@/server/admin/metrics`.
  - `FEED_OVERDUE_AFTER: SQL` from `@/server/sync/run-sync`.
  - `adminGet(path: string): Promise<Response>` from `test/e2e-forms.ts`.
  - `utcTime(value: Date | null): string` from `@/app/metrics/format`.
  - The admin layout at `src/app/metrics/layout.tsx`, whose `<nav aria-label="Admin">` later tasks add links to.
  - The two result shapes, kept module-private (only the page uses them, through inference):

```ts
interface Metrics {
  devices: { active7: number; active30: number; ios: number; android: number; blocked: number };
  tagging: {
    submissionsThisWeek: number;
    nearMeetingThisWeek: number;
    meetings: number;
    meetingsWithTags: number;
  };
  submissionsPerDay: { day: string; count: number }[];
  topTags: { label: string; submissions: number }[];
  vocabulary: { active: number; retired: number };
  pendingSuggestions: number;
  openSwings: number;
  feeds: { total: number; optedOut: number; needingAttention: number };
}
interface FeedAttention {
  slug: string;
  name: string;
  state: string;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
}
```

- [ ] **Step 1: Write the failing tests.** Create `apps/web/test/admin-metrics.test.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { devices, feeds, suggestions, tagSwings, tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { utcToday } from "@/db/sql";
import { readFeedsNeedingAttention, readMetrics } from "@/server/admin/metrics";
import { recountTags } from "@/server/tags/counts";

import { resetDb } from "./db";
import { seedFeed } from "./feed-fixtures";
import { elsewhere, insertSubmission, seedMeetingStarted } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const utcDate = (date: Date) => date.toISOString().slice(0, 10);

async function device(n: number, platform: "ios" | "android", lastSeenDaysAgo: number, blocked = false) {
  const day = sql`${utcToday} - ${lastSeenDaysAgo}::int`;
  await db.insert(devices).values({
    deviceHash: n.toString(16).padStart(64, "0"),
    platform,
    firstSeenDate: day,
    lastSeenDate: day,
    blocked,
  });
}

async function tagId(slug: string): Promise<number> {
  const [row] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug));
  if (row === undefined) throw new Error(`no tag ${slug}`);
  return row.id;
}

async function feedState(slug: string, state: Partial<typeof feeds.$inferInsert>) {
  await seedFeed(slug);
  if (Object.keys(state).length > 0) await db.update(feeds).set(state).where(eq(feeds.slug, slug));
}

describe("readMetrics (spec §10: totals only)", () => {
  it("counts phones active in the last 7 and 30 UTC days, by platform, and blocked ones", async () => {
    await device(1, "ios", 0);
    await device(2, "android", 6);
    await device(3, "ios", 7);
    await device(4, "ios", 29);
    await device(5, "android", 30, true);
    expect((await readMetrics()).devices).toEqual({
      active7: 2,
      active30: 4,
      ios: 3,
      android: 2,
      blocked: 1,
    });
  });

  it("counts this week's tagging, meetings with tags, submissions per day and top tags", async () => {
    const meetingId = await seedMeetingStarted(1);
    await seedMeetingStarted(1, elsewhere(1));
    await insertSubmission(meetingId, ["quiet", "coffee"], { nearMeeting: true });
    await insertSubmission(meetingId, ["quiet"]);
    await insertSubmission(meetingId, ["quiet"], { confirmedAt: daysAgo(8) });
    await insertSubmission(meetingId, ["lively"], { excluded: true });
    await recountTags([meetingId], db);

    const metrics = await readMetrics();
    expect(metrics.tagging).toEqual({
      submissionsThisWeek: 2,
      nearMeetingThisWeek: 1,
      meetings: 2,
      meetingsWithTags: 1,
    });
    expect(metrics.topTags).toEqual([
      { label: "Quiet", submissions: 3 },
      { label: "Coffee", submissions: 1 },
    ]);
    expect(metrics.submissionsPerDay).toHaveLength(14);
    expect(metrics.submissionsPerDay.at(-1)).toEqual({ day: utcDate(new Date()), count: 2 });
    expect(metrics.submissionsPerDay.at(-9)).toEqual({ day: utcDate(daysAgo(8)), count: 1 });
    expect(metrics.submissionsPerDay.at(-2)).toEqual({ day: utcDate(daysAgo(1)), count: 0 });
  });

  it("counts the vocabulary, pending suggestions and open swing flags", async () => {
    await db.update(tags).set({ status: "retired" }).where(eq(tags.slug, "quiet"));
    await db
      .insert(suggestions)
      .values([
        { text: "Relaxed" },
        { text: "Big print books" },
        { text: "Loud", status: "rejected", reviewedAt: new Date() },
      ]);
    const meetingId = await seedMeetingStarted(1);
    await db.insert(tagSwings).values([
      { meetingId, tagId: await tagId("lively"), newDevices: 5, priorDevices: 0 },
      { meetingId, tagId: await tagId("coffee"), newDevices: 6, priorDevices: 1, reviewedAt: new Date() },
    ]);
    expect(await readMetrics()).toMatchObject({
      vocabulary: { active: 25, retired: 1 },
      pendingSuggestions: 2,
      openSwings: 1,
    });
  });
});

describe("feed health (owner decision 1)", () => {
  it("lists feeds whose last attempt failed or that haven't succeeded in 8 days, oldest success first", async () => {
    await feedState("healthy", { lastAttemptAt: new Date(), lastSuccessAt: new Date() });
    await feedState("failing", {
      lastAttemptAt: new Date(),
      lastSuccessAt: daysAgo(3),
      lastError: "HTTP 503",
    });
    await feedState("overdue", { lastAttemptAt: daysAgo(1), lastSuccessAt: daysAgo(9) });
    await feedState("brand-new", {});
    await feedState("opted-out", { optedOut: true, lastAttemptAt: new Date(), lastError: "HTTP 404" });
    await feedState("never-worked", { lastAttemptAt: new Date(), lastError: "not a JSON array" });

    expect((await readFeedsNeedingAttention()).map((feed) => [feed.slug, feed.lastError])).toEqual([
      ["never-worked", "not a JSON array"],
      ["overdue", null],
      ["failing", "HTTP 503"],
    ]);
    expect((await readMetrics()).feeds).toEqual({ total: 6, optedOut: 1, needingAttention: 3 });
  });

  it("cuts a long error to 300 characters", async () => {
    await feedState("noisy", { lastAttemptAt: new Date(), lastError: "x".repeat(5000) });
    const [noisy] = await readFeedsNeedingAttention();
    expect(noisy?.lastError).toHaveLength(300);
  });
});
```

Create `apps/web/test/e2e-forms.ts`:

```ts
import { ADMIN_AUTHORIZATION, E2E_URL } from "./e2e-server";

// A signed-in page load, as the owner's browser makes it.
export function adminGet(path: string): Promise<Response> {
  return fetch(`${E2E_URL}${path}`, { headers: { authorization: ADMIN_AUTHORIZATION }, redirect: "manual" });
}
```

Create `apps/web/test/metrics.e2e.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { feeds } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";

import { resetDb } from "./db";
import { adminGet } from "./e2e-forms";
import { seedFeed } from "./feed-fixtures";
import { DEVICE_A_HASH, deviceHeaders, seedMeetingStarted } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

describe("/metrics in the built app", () => {
  it("shows totals and the failing feed, and nothing that identifies a phone (spec §14)", async () => {
    const meetingId = await seedMeetingStarted(1);
    const tagged = await POST(
      new Request("http://test/api/v1/tags", {
        method: "POST",
        headers: deviceHeaders(),
        body: JSON.stringify({ meetingId, tags: ["quiet"] }),
      }),
    );
    expect(tagged.status).toBe(201);
    await seedFeed("broken-feed");
    await db
      .update(feeds)
      .set({ lastAttemptAt: new Date(), lastError: "HTTP 503 from the feed" })
      .where(eq(feeds.slug, "broken-feed"));

    const res = await adminGet("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expect(html).toContain("broken-feed");
    expect(html).toContain("HTTP 503 from the feed");
    expect(html).not.toContain(DEVICE_A_HASH.slice(0, 12));
  });
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `pnpm --filter web exec vitest run admin-metrics`. Expected: FAIL, because `@/server/admin/metrics` doesn't exist.

- [ ] **Step 3: Implement the queries.** In `apps/web/src/server/sync/run-sync.ts`, add below `RETRY_INTERVAL`:

```ts
// A feed that has gone longer than this without a success has missed its weekly sync and its retry (owner decision
// 1; /metrics shows it).
export const FEED_OVERDUE_AFTER = sql`${SUCCESS_INTERVAL} + ${RETRY_INTERVAL}`;
```

Create `apps/web/src/server/admin/metrics.ts`:

```ts
import { and, asc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  devices,
  feeds,
  meetings,
  suggestions,
  tagCounts,
  tagSubmissions,
  tagSwings,
  tags,
} from "@/db/schema";
import { utcToday } from "@/db/sql";
import { FEED_OVERDUE_AFTER } from "@/server/sync/run-sync";

const ERROR_SHOWN = 300;
const TOP_TAGS = 10;
const DAYS_CHARTED = 14;

interface Metrics {
  devices: { active7: number; active30: number; ios: number; android: number; blocked: number };
  tagging: {
    submissionsThisWeek: number;
    nearMeetingThisWeek: number;
    meetings: number;
    meetingsWithTags: number;
  };
  submissionsPerDay: { day: string; count: number }[];
  topTags: { label: string; submissions: number }[];
  vocabulary: { active: number; retired: number };
  pendingSuggestions: number;
  openSwings: number;
  feeds: { total: number; optedOut: number; needingAttention: number };
}

interface FeedAttention {
  slug: string;
  name: string;
  state: string;
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
}

// Extends Record so db.execute accepts it as a row type.
interface Totals extends Record<string, number> {
  active7: number;
  active30: number;
  ios: number;
  android: number;
  blocked: number;
  submissionsThisWeek: number;
  nearMeetingThisWeek: number;
  meetings: number;
  meetingsWithTags: number;
  activeTags: number;
  retiredTags: number;
  pendingSuggestions: number;
  openSwings: number;
  feeds: number;
  optedOutFeeds: number;
  feedsNeedingAttention: number;
}

// Owner decision 1: a feed needs attention when its last attempt failed, or when it has been tried but hasn't
// succeeded for longer than the weekly sync plus the one-day retry. Opted-out feeds are never synced.
const needsAttention = and(
  eq(feeds.optedOut, false),
  or(
    isNotNull(feeds.lastError),
    and(
      isNotNull(feeds.lastAttemptAt),
      or(isNull(feeds.lastSuccessAt), lt(feeds.lastSuccessAt, sql`now() - ${FEED_OVERDUE_AFTER}`)),
    ),
  ),
);

const thisWeek = sql`not ${tagSubmissions.excluded} and ${tagSubmissions.confirmedAt} > now() - interval '7 days'`;

// Spec §10: every figure is a count over many rows. Nothing here returns a row about one device.
async function readTotals(): Promise<Totals> {
  const { rows } = await db.execute<Totals>(sql`
    select
      (select count(*)::int from ${devices} where ${devices.lastSeenDate} >= ${utcToday} - 6) as "active7",
      (select count(*)::int from ${devices} where ${devices.lastSeenDate} >= ${utcToday} - 29) as "active30",
      (select count(*)::int from ${devices} where ${devices.platform} = 'ios') as "ios",
      (select count(*)::int from ${devices} where ${devices.platform} = 'android') as "android",
      (select count(*)::int from ${devices} where ${devices.blocked}) as "blocked",
      (select count(*)::int from ${tagSubmissions} where ${thisWeek}) as "submissionsThisWeek",
      (select count(*)::int from ${tagSubmissions} where ${thisWeek} and ${tagSubmissions.nearMeeting})
        as "nearMeetingThisWeek",
      (select count(*)::int from ${meetings} where ${meetings.archivedAt} is null) as "meetings",
      (select count(distinct ${tagCounts.meetingId})::int from ${tagCounts}
        join ${meetings} on ${meetings.id} = ${tagCounts.meetingId} where ${meetings.archivedAt} is null)
        as "meetingsWithTags",
      (select count(*)::int from ${tags} where ${tags.status} = 'active') as "activeTags",
      (select count(*)::int from ${tags} where ${tags.status} = 'retired') as "retiredTags",
      (select count(*)::int from ${suggestions} where ${suggestions.status} = 'pending') as "pendingSuggestions",
      (select count(*)::int from ${tagSwings} where ${tagSwings.reviewedAt} is null) as "openSwings",
      (select count(*)::int from ${feeds}) as "feeds",
      (select count(*)::int from ${feeds} where ${feeds.optedOut}) as "optedOutFeeds",
      (select count(*)::int from ${feeds} where ${needsAttention}) as "feedsNeedingAttention"
  `);
  const [totals] = rows;
  if (totals === undefined) throw new Error("the totals query returned no row");
  return totals;
}

// By UTC date of each row's latest confirmation, with days that had none included.
async function readSubmissionsPerDay(): Promise<{ day: string; count: number }[]> {
  const { rows } = await db.execute<{ day: string; count: number }>(sql`
    select to_char(day, 'YYYY-MM-DD') as "day", count(${tagSubmissions.submitterId})::int as "count"
    from generate_series(
      (${utcToday} - ${DAYS_CHARTED - 1}::int)::timestamp, ${utcToday}::timestamp, interval '1 day'
    ) as day
    left join ${tagSubmissions}
      on (${tagSubmissions.confirmedAt} at time zone 'utc')::date = day::date and not ${tagSubmissions.excluded}
    group by day
    order by day
  `);
  return rows;
}

async function readTopTags(): Promise<{ label: string; submissions: number }[]> {
  const { rows } = await db.execute<{ label: string; submissions: number }>(sql`
    select t.label as "label", count(*)::int as "submissions"
    from ${tagSubmissions} s cross join lateral unnest(s.tag_ids) as tag_id join ${tags} t on t.id = tag_id
    where not s.excluded and s.confirmed_at > now() - interval '30 days'
    group by t.id, t.label
    order by "submissions" desc, t.label
    limit ${TOP_TAGS}
  `);
  return rows;
}

export async function readMetrics(): Promise<Metrics> {
  const [totals, submissionsPerDay, topTags] = await Promise.all([
    readTotals(),
    readSubmissionsPerDay(),
    readTopTags(),
  ]);
  return {
    devices: {
      active7: totals.active7,
      active30: totals.active30,
      ios: totals.ios,
      android: totals.android,
      blocked: totals.blocked,
    },
    tagging: {
      submissionsThisWeek: totals.submissionsThisWeek,
      nearMeetingThisWeek: totals.nearMeetingThisWeek,
      meetings: totals.meetings,
      meetingsWithTags: totals.meetingsWithTags,
    },
    submissionsPerDay,
    topTags,
    vocabulary: { active: totals.activeTags, retired: totals.retiredTags },
    pendingSuggestions: totals.pendingSuggestions,
    openSwings: totals.openSwings,
    feeds: {
      total: totals.feeds,
      optedOut: totals.optedOutFeeds,
      needingAttention: totals.feedsNeedingAttention,
    },
  };
}

// Spec §10 and §14: per-feed sync health. Feeds are publishers, not people. An error is cut short so a feed that
// answered with a whole HTML page can't swamp the page.
export async function readFeedsNeedingAttention(): Promise<FeedAttention[]> {
  return db
    .select({
      slug: feeds.slug,
      name: feeds.name,
      state: feeds.state,
      lastAttemptAt: feeds.lastAttemptAt,
      lastSuccessAt: feeds.lastSuccessAt,
      lastError: sql<string | null>`left(${feeds.lastError}, ${ERROR_SHOWN}::int)`,
    })
    .from(feeds)
    .where(needsAttention)
    .orderBy(sql`${feeds.lastSuccessAt} asc nulls first`, asc(feeds.slug));
}
```

- [ ] **Step 4: Run them and watch them pass.** Run `pnpm --filter web exec vitest run admin-metrics`. Expected: PASS.

- [ ] **Step 5: Write the layout and the page.** Create `apps/web/src/app/metrics/format.ts`:

```ts
// Admin pages show times in UTC, the zone the metrics and the maintenance cron count days in.
export function utcTime(value: Date | null): string {
  return value === null ? "never" : `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
```

Create `apps/web/src/app/metrics/layout.tsx`:

```tsx
import { BRAND } from "@mymeetingapp/shared";
import type { Metadata } from "next";
import type { ReactNode } from "react";

// Spec §10: never indexed. proxy.ts also sends X-Robots-Tag and no-store with every /metrics response.
export const metadata: Metadata = {
  title: `Metrics · ${BRAND.appName}`,
  robots: { index: false, follow: false },
};

export default function MetricsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="site-header">
        <a className="wordmark" href="/metrics">
          {BRAND.appName} metrics
        </a>
        <nav aria-label="Admin">
          <a href="/metrics">Overview</a>
        </nav>
      </header>
      <main className="page admin">{children}</main>
    </>
  );
}
```

Create `apps/web/src/app/metrics/page.tsx`:

```tsx
import { utcTime } from "@/app/metrics/format";
import { readFeedsNeedingAttention, readMetrics } from "@/server/admin/metrics";

export const dynamic = "force-dynamic";

function share(part: number, whole: number): string {
  return whole === 0 ? "–" : `${String(Math.round((part / whole) * 100))}%`;
}

function Total({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default async function MetricsPage() {
  const [metrics, attention] = await Promise.all([readMetrics(), readFeedsNeedingAttention()]);
  const { devices, tagging } = metrics;
  return (
    <>
      <h1>Metrics</h1>
      <p className="fine-print">Totals only. Nothing on this page identifies a phone.</p>

      <h2>Phones</h2>
      <dl className="totals">
        <Total label="Active in the last 7 days" value={devices.active7} />
        <Total label="Active in the last 30 days" value={devices.active30} />
        <Total label="iPhone" value={devices.ios} />
        <Total label="Android" value={devices.android} />
        <Total label="Blocked" value={devices.blocked} />
      </dl>

      <h2>Tagging</h2>
      <dl className="totals">
        <Total label="Tag submissions this week" value={tagging.submissionsThisWeek} />
        <Total
          label="Near the meeting this week"
          value={share(tagging.nearMeetingThisWeek, tagging.submissionsThisWeek)}
        />
        <Total
          label="Meetings with tags"
          value={`${String(tagging.meetingsWithTags)} of ${String(tagging.meetings)}`}
        />
        <Total label="Suggestions waiting" value={metrics.pendingSuggestions} />
        <Total label="Open swing flags" value={metrics.openSwings} />
        <Total
          label="Tags in use / retired"
          value={`${String(metrics.vocabulary.active)} / ${String(metrics.vocabulary.retired)}`}
        />
      </dl>

      <h2>Submissions per day (UTC)</h2>
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>Submissions</th>
          </tr>
        </thead>
        <tbody>
          {metrics.submissionsPerDay.map((row) => (
            <tr key={row.day}>
              <td>{row.day}</td>
              <td>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Top tags (30 days)</h2>
      <ol>
        {metrics.topTags.map((tag) => (
          <li key={tag.label}>
            {tag.label}: {tag.submissions}
          </li>
        ))}
      </ol>

      <h2>Feeds</h2>
      <dl className="totals">
        <Total label="Feeds" value={metrics.feeds.total} />
        <Total label="Opted out" value={metrics.feeds.optedOut} />
        <Total label="Needing attention" value={metrics.feeds.needingAttention} />
      </dl>
      <h3>Feeds needing attention</h3>
      {attention.length === 0 ? (
        <p>None. Every feed is syncing on schedule.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Feed</th>
              <th>Last success</th>
              <th>Last attempt</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {attention.map((feed) => (
              <tr key={feed.slug}>
                <td>
                  {feed.name} ({feed.slug}, {feed.state})
                </td>
                <td>{utcTime(feed.lastSuccessAt)}</td>
                <td>{utcTime(feed.lastAttemptAt)}</td>
                <td>{feed.lastError ?? "Overdue"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
```

- [ ] **Step 6: Run the end-to-end tests.** Run `pnpm --filter web test:e2e`. Expected: PASS. The build lists `ƒ /metrics` (dynamic). The static pages stay `○`.

- [ ] **Step 7: Update the spec.** In `SPEC.md` §10 "Shows", replace "per-feed sync health (flag feeds without a successful sync in 30 hours)" with "per-feed sync health (flag feeds whose last attempt failed, or that have been tried without a success for 8 days: the weekly sync plus its one-day retry)". Run `pnpm check`. Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add apps/web SPEC.md
git commit -m "feat(admin): /metrics overview with totals and feed health"
```

---

### Task 8: Suggestion review, and the Server Action plumbing

**Files:**

- Create:
  - `apps/web/src/server/admin/suggestions.ts`, `apps/web/src/server/admin/notices.ts`, `apps/web/src/server/admin/form-fields.ts`
  - `apps/web/src/app/metrics/admin-action.ts`, `apps/web/src/app/metrics/actions.ts`, `apps/web/src/app/metrics/notice.tsx`
  - `apps/web/src/app/metrics/suggestions/page.tsx`
  - `apps/web/drizzle/0015_suggestion-approved.sql` (generated)
  - `apps/web/test/admin-suggestions.test.ts`, `apps/web/test/admin-notice.test.tsx`, `apps/web/test/admin-suggestions.e2e.ts`
- Modify:
  - `packages/shared/src/suggestions.ts`, `apps/web/src/db/schema/suggestions.ts`
  - `apps/web/src/app/metrics/layout.tsx`, `apps/web/test/e2e-forms.ts`, `docs/standards.md`

**Interfaces:**

- Consumes:
  - `isAdminAuthorization` (Task 6), `getActiveVocabulary` from `@/server/vocabulary`, `TAG_CATEGORIES` and `TagSlug` from `@mymeetingapp/shared`.
  - `adminGet`, `ADMIN_AUTHORIZATION` and `E2E_URL` (Tasks 1, 6 and 7).
- Produces:
  - `TagLabelText` (zod) from `@mymeetingapp/shared`.
  - `FormId` (zod: a form string to a positive integer) from `@/server/admin/form-fields`.
  - `ADMIN_NOTICES`, `type AdminNotice` and `isAdminNotice(value: unknown): value is AdminNotice` from `@/server/admin/notices`. Tasks 9–11 add their own codes.
  - `adminAction(returnTo: string, schema, run): (formData: FormData) => Promise<never>` from `@/app/metrics/admin-action`. Task 9 lets `returnTo` be a function of the parsed form.
  - `Notice({ params })` and `type SearchParams` from `@/app/metrics/notice`.
  - From `@/server/admin/suggestions`:
    - `ApproveSuggestionForm`, `MergeSuggestionForm`, `RejectSuggestionForm`;
    - `listPendingSuggestions()`, `listRecentAiDecisions()`;
    - `approveSuggestion(input)`, `mergeSuggestion(input)`, `rejectSuggestion(input)`, each returning `Promise<AdminNotice>`.
  - `formContaining(html: string, marker: string): Record<string, string>` and `submitForm(path: string, fields: Record<string, string>, origin?: string): Promise<Response>` from `test/e2e-forms.ts`.

- [ ] **Step 1: Write the failing tests.** Create `apps/web/test/admin-suggestions.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { aiDecisions, suggestions, tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import {
  ApproveSuggestionForm,
  approveSuggestion,
  listPendingSuggestions,
  listRecentAiDecisions,
  mergeSuggestion,
  rejectSuggestion,
} from "@/server/admin/suggestions";

import { resetDb } from "./db";
import { DEVICE_A_HASH } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

async function pendingSuggestion(text: string): Promise<number> {
  const [row] = await db
    .insert(suggestions)
    .values({ text, deviceHash: DEVICE_A_HASH })
    .returning({ id: suggestions.id });
  if (row === undefined) throw new Error("the suggestion was not saved");
  return row.id;
}

async function suggestionRow(id: number) {
  const [row] = await db
    .select({
      status: suggestions.status,
      mergedTagId: suggestions.mergedTagId,
      deviceHash: suggestions.deviceHash,
      reviewedAt: suggestions.reviewedAt,
    })
    .from(suggestions)
    .where(eq(suggestions.id, id));
  return row;
}

async function tagBySlug(slug: string) {
  const [row] = await db.select().from(tags).where(eq(tags.slug, slug));
  return row;
}

describe("listPendingSuggestions", () => {
  it("lists pending suggestions oldest first with their AI decisions, and never the device", async () => {
    const newer = await pendingSuggestion("Relaxed");
    const older = await pendingSuggestion("Big print books");
    await db
      .update(suggestions)
      .set({ createdAt: new Date("2026-09-01T00:00:00Z") })
      .where(eq(suggestions.id, older));
    await db.insert(aiDecisions).values({
      suggestionId: newer,
      input: "Relaxed",
      decision: "pending",
      tagSlug: null,
      reason: "Unsure.",
      model: "openai/gpt-5-nano",
    });
    await rejectSuggestion({ suggestionId: await pendingSuggestion("Loud") });

    const pending = await listPendingSuggestions();
    expect(
      pending.map((row) => [row.id, row.text, row.decisions.map((ai) => [ai.decision, ai.reason])]),
    ).toEqual([
      [older, "Big print books", []],
      [newer, "Relaxed", [["pending", "Unsure."]]],
    ]);
    expect(JSON.stringify(pending)).not.toContain(DEVICE_A_HASH);
  });
});

describe("listRecentAiDecisions", () => {
  it("lists the latest decisions with what became of each suggestion", async () => {
    const id = await pendingSuggestion("Relaxed");
    await db.insert(aiDecisions).values({
      suggestionId: id,
      input: "Relaxed",
      decision: "merge",
      tagSlug: "laid-back",
      reason: "A synonym.",
      model: "openai/gpt-5-nano",
    });
    await rejectSuggestion({ suggestionId: id });
    expect(
      (await listRecentAiDecisions()).map((ai) => [ai.input, ai.decision, ai.tagSlug, ai.status]),
    ).toEqual([["Relaxed", "merge", "laid-back", "rejected"]]);
  });
});

describe("approveSuggestion (spec §5)", () => {
  it("adds an active tag from the label, last in the vocabulary order, and unlinks the device", async () => {
    const id = await pendingSuggestion("Big print books");
    expect(
      await approveSuggestion({ suggestionId: id, label: "Large print books", category: "practical" }),
    ).toBe("approved");
    const tag = await tagBySlug("large-print-books");
    expect(tag).toMatchObject({
      label: "Large print books",
      category: "practical",
      status: "active",
      sortOrder: 26,
    });
    const row = await suggestionRow(id);
    expect(row).toMatchObject({ status: "approved", mergedTagId: tag?.id, deviceHash: null });
    expect(row?.reviewedAt).toBeInstanceOf(Date);
  });

  it("folds accents and '&' into the tag's id", async () => {
    const id = await pendingSuggestion("Café & chat");
    await approveSuggestion({ suggestionId: id, label: "Café & chat", category: "feel" });
    expect(await tagBySlug("cafe-and-chat")).toMatchObject({ label: "Café & chat" });
  });

  it("refuses a label that makes an existing tag's slug, leaving the suggestion pending", async () => {
    const id = await pendingSuggestion("Laid-back");
    expect(await approveSuggestion({ suggestionId: id, label: "Laid-back", category: "format" })).toBe(
      "tag_exists",
    );
    expect(await suggestionRow(id)).toMatchObject({ status: "pending", deviceHash: DEVICE_A_HASH });
  });

  it("refuses a label with no letters a–z", async () => {
    const id = await pendingSuggestion("静か");
    expect(await approveSuggestion({ suggestionId: id, label: "静か", category: "feel" })).toBe(
      "label_invalid",
    );
    expect(await suggestionRow(id)).toMatchObject({ status: "pending" });
  });

  it("a second review of the same suggestion changes nothing", async () => {
    const id = await pendingSuggestion("Big print books");
    await approveSuggestion({ suggestionId: id, label: "Large print books", category: "practical" });
    expect(await approveSuggestion({ suggestionId: id, label: "Big print", category: "practical" })).toBe(
      "already_reviewed",
    );
    expect(await rejectSuggestion({ suggestionId: id })).toBe("already_reviewed");
    expect(await tagBySlug("big-print")).toBeUndefined();
    expect(await suggestionRow(id)).toMatchObject({ status: "approved" });
  });

  it("won't store an approved suggestion without its tag", async () => {
    const id = await pendingSuggestion("Relaxed");
    await expect(
      db.update(suggestions).set({ status: "approved" }).where(eq(suggestions.id, id)),
    ).rejects.toMatchObject({ cause: { constraint: "suggestions_merged_tag_check" } });
  });
});

describe("mergeSuggestion", () => {
  it("merges into an active tag and unlinks the device", async () => {
    const id = await pendingSuggestion("Chill");
    expect(await mergeSuggestion({ suggestionId: id, tagSlug: "laid-back" })).toBe("merged");
    expect(await suggestionRow(id)).toMatchObject({
      status: "merged",
      mergedTagId: (await tagBySlug("laid-back"))?.id,
      deviceHash: null,
    });
  });

  it("refuses a retired tag", async () => {
    await db.update(tags).set({ status: "retired" }).where(eq(tags.slug, "laid-back"));
    const id = await pendingSuggestion("Chill");
    expect(await mergeSuggestion({ suggestionId: id, tagSlug: "laid-back" })).toBe("tag_not_found");
    expect(await suggestionRow(id)).toMatchObject({ status: "pending" });
  });
});

describe("rejectSuggestion", () => {
  it("rejects and unlinks the device", async () => {
    const id = await pendingSuggestion("Loud");
    expect(await rejectSuggestion({ suggestionId: id })).toBe("rejected");
    expect(await suggestionRow(id)).toMatchObject({
      status: "rejected",
      mergedTagId: null,
      deviceHash: null,
    });
  });
});

describe("ApproveSuggestionForm", () => {
  it("reads a submitted form: the id as a number and the label trimmed", () => {
    expect(
      ApproveSuggestionForm.parse({
        suggestionId: "3",
        label: "  Large print books ",
        category: "practical",
      }),
    ).toEqual({ suggestionId: 3, label: "Large print books", category: "practical" });
  });

  it.each([
    { suggestionId: "3", label: "<b>Loud</b>", category: "feel" },
    { suggestionId: "x", label: "Relaxed", category: "feel" },
    { suggestionId: "3", label: "Relaxed", category: "vibes" },
  ])("refuses %j", (form) => {
    expect(ApproveSuggestionForm.safeParse(form).success).toBe(false);
  });
});
```

Create `apps/web/test/admin-notice.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";

import { Notice } from "@/app/metrics/notice";

import { renderText } from "./render";

describe("Notice", () => {
  it("shows the message for the outcome an admin action returned", () => {
    expect(renderText(<Notice params={{ notice: "rejected" }} />)).toBe("Rejected.");
  });

  it.each([{}, { notice: "toString" }, { notice: "<script>" }, { notice: ["rejected", "approved"] }])(
    "shows nothing for %j",
    (params) => {
      expect(renderText(<Notice params={params} />)).toBe("");
    },
  );
});
```

Add to `apps/web/test/e2e-forms.ts`:

```ts
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#x27;": "'",
  "&lt;": "<",
  "&gt;": ">",
};
const decode = (value: string) =>
  value.replace(/&(?:amp|quot|#x27|lt|gt);/g, (entity) => ENTITIES[entity] ?? entity);

// The fields of the server-rendered <form> whose markup contains `marker` (its aria-label, say), with the values a
// browser would send: inputs as rendered and each select's selected option, or its first. Next.js renders a Server
// Action form with a hidden $ACTION_ID_… field naming the action, so posting these fields is exactly what a browser
// without JavaScript does.
export function formContaining(html: string, marker: string): Record<string, string> {
  const form = [...html.matchAll(/<form[\s\S]*?<\/form>/g)]
    .map((match) => match[0])
    .find((markup) => markup.includes(marker));
  if (form === undefined) throw new Error(`no form containing ${marker}`);
  const fields: Record<string, string> = {};
  for (const [input] of form.matchAll(/<input[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(input)?.[1];
    if (name !== undefined) fields[decode(name)] = decode(/value="([^"]*)"/.exec(input)?.[1] ?? "");
  }
  for (const [, name = "", options = ""] of form.matchAll(
    /<select[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g,
  )) {
    const optionTags = [...options.matchAll(/<option([^>]*)>/g)].map((match) => match[1] ?? "");
    const chosen = optionTags.find((attributes) => attributes.includes('selected=""')) ?? optionTags[0] ?? "";
    fields[name] = decode(/value="([^"]*)"/.exec(chosen)?.[1] ?? "");
  }
  return fields;
}

// Posts a form as the signed-in owner's browser would: from this site, unless `origin` says otherwise.
export function submitForm(
  path: string,
  fields: Record<string, string>,
  origin = E2E_URL,
): Promise<Response> {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.append(name, value);
  return fetch(`${E2E_URL}${path}`, {
    method: "POST",
    body,
    redirect: "manual",
    headers: { authorization: ADMIN_AUTHORIZATION, origin },
  });
}
```

Create `apps/web/test/admin-suggestions.e2e.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { suggestions, tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";

import { resetDb } from "./db";
import { adminGet, formContaining, submitForm } from "./e2e-forms";
import { DEVICE_A_HASH } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

async function pending(text: string): Promise<number> {
  const [row] = await db
    .insert(suggestions)
    .values({ text, deviceHash: DEVICE_A_HASH })
    .returning({ id: suggestions.id });
  if (row === undefined) throw new Error("the suggestion was not saved");
  return row.id;
}

async function suggestionRow(id: number) {
  const [row] = await db
    .select({ status: suggestions.status, deviceHash: suggestions.deviceHash })
    .from(suggestions)
    .where(eq(suggestions.id, id));
  return row;
}

async function reviewPage(): Promise<string> {
  const res = await adminGet("/metrics/suggestions");
  expect(res.status).toBe(200);
  return res.text();
}

describe("suggestion review in the built app", () => {
  it("rejects a suggestion from its form, unlinks the device and says so", async () => {
    const id = await pending("Relaxed");
    const html = await reviewPage();
    expect(html).not.toContain(DEVICE_A_HASH);
    const res = await submitForm("/metrics/suggestions", formContaining(html, "Reject “Relaxed”"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/\/metrics\/suggestions\?notice=rejected$/);
    expect(await suggestionRow(id)).toEqual({ status: "rejected", deviceHash: null });
    expect(await (await adminGet("/metrics/suggestions?notice=rejected")).text()).toContain("Rejected.");
  });

  it("adds a suggestion as a new tag with the label and category chosen", async () => {
    const id = await pending("Relaxed");
    const form = { ...formContaining(await reviewPage(), "Add “Relaxed” as a new tag"), label: "Easygoing" };
    const res = await submitForm("/metrics/suggestions", { ...form, category: "feel" });
    expect(res.headers.get("location")).toMatch(/notice=approved$/);
    const [tag] = await db
      .select({ label: tags.label, category: tags.category })
      .from(tags)
      .where(eq(tags.slug, "easygoing"));
    expect(tag).toEqual({ label: "Easygoing", category: "feel" });
    expect(await suggestionRow(id)).toEqual({ status: "approved", deviceHash: null });
  });

  it("refuses a label with markup and leaves the suggestion pending", async () => {
    const id = await pending("Relaxed");
    const form = {
      ...formContaining(await reviewPage(), "Add “Relaxed” as a new tag"),
      label: "<b>Loud</b>",
    };
    const res = await submitForm("/metrics/suggestions", form);
    expect(res.headers.get("location")).toMatch(/notice=invalid_form$/);
    expect(await suggestionRow(id)).toEqual({ status: "pending", deviceHash: DEVICE_A_HASH });
  });

  it("refuses the same form posted from another site (spec §14)", async () => {
    const id = await pending("Relaxed");
    const form = formContaining(await reviewPage(), "Reject “Relaxed”");
    const res = await submitForm("/metrics/suggestions", form, "https://evil.example");
    expect(res.status).toBe(403);
    expect(await suggestionRow(id)).toEqual({ status: "pending", deviceHash: DEVICE_A_HASH });
  });
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `pnpm --filter web exec vitest run admin-suggestions admin-notice`. Expected: FAIL, because `@/server/admin/suggestions` and `@/app/metrics/notice` don't exist.

- [ ] **Step 3: Add the `approved` status.** In `packages/shared/src/suggestions.ts`, replace the `SuggestionRequest` definition with:

```ts
// Spec §5: a tag's words, 2–40 characters after trimming: letters, digits, spaces, apostrophes, hyphens and
// ampersands, starting with a letter or digit, so nothing that could be a link or markup gets in. A suggestion and a
// label the admin approves both use it.
export const TagLabelText = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} '’&-]*$/u);

export const SuggestionRequest = z.object({ text: TagLabelText });
```

In `apps/web/src/db/schema/suggestions.ts`:

```ts
const SUGGESTION_STATUSES = ["pending", "approved", "merged", "rejected"] as const;
// The statuses that name a tag: approved (it became a new tag) and merged (into an existing one).
const TAGGED_STATUSES = ["approved", "merged"] as const;
```

Change the comment on `mergedTagId` to `// The tag it became (approved) or joined (merged).`, and change the check to:

```ts
    check(
      "suggestions_merged_tag_check",
      sql`(${table.status} in (${sqlStringList(TAGGED_STATUSES)})) = (${table.mergedTagId} is not null)`,
    ),
```

Run `pnpm --filter web db:generate --name suggestion-approved`. Expected: `apps/web/drizzle/0015_suggestion-approved.sql` drops and re-adds `suggestions_status_check` (now with `'approved'`) and `suggestions_merged_tag_check` (now `("suggestions"."status" in ('approved', 'merged')) = ("suggestions"."merged_tag_id" is not null)`). Nothing else changes.

- [ ] **Step 4: Implement the review functions.** Create `apps/web/src/server/admin/form-fields.ts`:

```ts
import { z } from "zod";

// Form fields arrive as strings.
export const FormId = z.coerce.number().int().positive();
```

Create `apps/web/src/server/admin/notices.ts`:

```ts
// The outcome of an admin action, shown on the page it returns to (?notice=<code>). Each admin view adds its own.
export const ADMIN_NOTICES = {
  invalid_form:
    "Something in that form wasn't valid. A label is 2–40 letters, digits, spaces, apostrophes, hyphens or &.",
  approved: "Added the new tag. The app's tag list picks it up within an hour.",
  merged: "Merged into the existing tag.",
  rejected: "Rejected.",
  already_reviewed: "That suggestion was already reviewed.",
  tag_exists: "A tag with that name already exists. Merge into it instead.",
  label_invalid: "That label has no letters a–z to make the tag's id from. Use Latin letters.",
  tag_not_found: "That tag isn't in the vocabulary, or has been retired.",
} as const;

export type AdminNotice = keyof typeof ADMIN_NOTICES;

// hasOwn, so a query string like ?notice=toString finds nothing.
export function isAdminNotice(value: unknown): value is AdminNotice {
  return typeof value === "string" && Object.hasOwn(ADMIN_NOTICES, value);
}
```

Create `apps/web/src/server/admin/suggestions.ts`:

```ts
import { TAG_CATEGORIES, TagLabelText, TagSlug } from "@mymeetingapp/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db, type Executor } from "@/db/client";
import { aiDecisions, suggestions, tags } from "@/db/schema";
import { FormId } from "@/server/admin/form-fields";
import type { AdminNotice } from "@/server/admin/notices";

const RECENT_DECISIONS = 50;

export const ApproveSuggestionForm = z.object({
  suggestionId: FormId,
  label: TagLabelText,
  category: z.enum(TAG_CATEGORIES),
});
export const MergeSuggestionForm = z.object({ suggestionId: FormId, tagSlug: TagSlug });
export const RejectSuggestionForm = z.object({ suggestionId: FormId });

// Spec §5: the weekly review. Pending suggestions oldest first, each with every AI decision logged for it. The
// device link is never read here.
export async function listPendingSuggestions() {
  const pending = await db
    .select({ id: suggestions.id, text: suggestions.text, createdAt: suggestions.createdAt })
    .from(suggestions)
    .where(eq(suggestions.status, "pending"))
    .orderBy(asc(suggestions.createdAt), asc(suggestions.id));
  const decisions =
    pending.length === 0
      ? []
      : await db
          .select({
            suggestionId: aiDecisions.suggestionId,
            decision: aiDecisions.decision,
            tagSlug: aiDecisions.tagSlug,
            reason: aiDecisions.reason,
            model: aiDecisions.model,
            decidedAt: aiDecisions.decidedAt,
          })
          .from(aiDecisions)
          .where(
            inArray(
              aiDecisions.suggestionId,
              pending.map((row) => row.id),
            ),
          )
          .orderBy(asc(aiDecisions.decidedAt), asc(aiDecisions.id));
  return pending.map((row) => ({
    ...row,
    decisions: decisions.filter((decision) => decision.suggestionId === row.id),
  }));
}

// Spec §10: the AI decision log, newest first, with what became of each suggestion.
export async function listRecentAiDecisions() {
  return db
    .select({
      id: aiDecisions.id,
      input: aiDecisions.input,
      decision: aiDecisions.decision,
      tagSlug: aiDecisions.tagSlug,
      reason: aiDecisions.reason,
      model: aiDecisions.model,
      decidedAt: aiDecisions.decidedAt,
      status: suggestions.status,
    })
    .from(aiDecisions)
    .innerJoin(suggestions, eq(suggestions.id, aiDecisions.suggestionId))
    .orderBy(desc(aiDecisions.decidedAt), desc(aiDecisions.id))
    .limit(RECENT_DECISIONS);
}

// "Café & chat" becomes "cafe-and-chat". A label with no letters a–z left gives no id.
function tagSlugFor(label: string): string | undefined {
  const slug = label
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return TagSlug.safeParse(slug).success ? slug : undefined;
}

// Spec §5: reviewing ends the suggestion's link to its device. Only a pending suggestion changes, so a form sent
// twice reviews once.
async function markReviewed(
  suggestionId: number,
  status: "approved" | "merged" | "rejected",
  mergedTagId: number | null,
  executor: Executor,
): Promise<boolean> {
  const reviewed = await executor
    .update(suggestions)
    .set({ status, mergedTagId, deviceHash: null, reviewedAt: sql`now()` })
    .where(and(eq(suggestions.id, suggestionId), eq(suggestions.status, "pending")))
    .returning({ id: suggestions.id });
  return reviewed.length > 0;
}

// Adds the label as a new active tag, last in the vocabulary order, and marks the suggestion approved.
export async function approveSuggestion(input: z.output<typeof ApproveSuggestionForm>): Promise<AdminNotice> {
  const slug = tagSlugFor(input.label);
  if (slug === undefined) return "label_invalid";
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ id: suggestions.id })
      .from(suggestions)
      .where(and(eq(suggestions.id, input.suggestionId), eq(suggestions.status, "pending")))
      .for("update");
    if (pending === undefined) return "already_reviewed";
    const [tag] = await tx
      .insert(tags)
      .values({
        slug,
        label: input.label,
        category: input.category,
        sortOrder: sql`(select coalesce(max(${tags.sortOrder}), -1) + 1 from ${tags})`,
      })
      .onConflictDoNothing({ target: tags.slug })
      .returning({ id: tags.id });
    if (tag === undefined) return "tag_exists";
    await markReviewed(input.suggestionId, "approved", tag.id, tx);
    return "approved";
  });
}

export async function mergeSuggestion(input: z.output<typeof MergeSuggestionForm>): Promise<AdminNotice> {
  return db.transaction(async (tx) => {
    const [tag] = await tx
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.slug, input.tagSlug), eq(tags.status, "active")));
    if (tag === undefined) return "tag_not_found";
    return (await markReviewed(input.suggestionId, "merged", tag.id, tx)) ? "merged" : "already_reviewed";
  });
}

export async function rejectSuggestion(input: z.output<typeof RejectSuggestionForm>): Promise<AdminNotice> {
  return (await markReviewed(input.suggestionId, "rejected", null, db)) ? "rejected" : "already_reviewed";
}
```

- [ ] **Step 5: Run the unit tests and watch them pass.** Run `pnpm --filter web exec vitest run admin-suggestions` and `pnpm --filter @mymeetingapp/shared test`. Expected: PASS. Then run `pnpm --filter web exec vitest run admin-notice`. Expected: still FAIL, because the notice component doesn't exist yet.

- [ ] **Step 6: Write the action plumbing and the page.** Create `apps/web/src/app/metrics/notice.tsx`:

```tsx
import { ADMIN_NOTICES, isAdminNotice } from "@/server/admin/notices";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The outcome an admin action redirected back with. An unknown code shows nothing.
export function Notice({ params }: { params: Record<string, string | string[] | undefined> }) {
  const code = params.notice;
  if (!isAdminNotice(code)) return null;
  return (
    <p className="notice" role="status">
      {ADMIN_NOTICES[code]}
    </p>
  );
}
```

Create `apps/web/src/app/metrics/admin-action.ts`:

```ts
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { z } from "zod";

import { isAdminAuthorization } from "@/lib/admin-auth";
import type { AdminNotice } from "@/server/admin/notices";

// Spec §10: every admin change is a Server Action on a /metrics page. proxy.ts has already checked the credentials
// and that the post came from this site. The action checks the credentials again, as the Next.js docs advise, so
// moving an action can never leave it unguarded. It validates the form, runs the change and sends the browser back
// to the page with the outcome (a 303 for a form posted without JavaScript).
export function adminAction<Schema extends z.ZodType>(
  returnTo: string,
  schema: Schema,
  run: (input: z.output<Schema>) => Promise<AdminNotice>,
): (formData: FormData) => Promise<never> {
  return async (formData) => {
    if (!isAdminAuthorization((await headers()).get("authorization"))) throw new Error("Not signed in");
    const parsed = schema.safeParse(Object.fromEntries(formData));
    const notice: AdminNotice = parsed.success ? await run(parsed.data) : "invalid_form";
    redirect(`${returnTo}?notice=${notice}`);
  };
}
```

Create `apps/web/src/app/metrics/actions.ts`:

```ts
"use server";

import { adminAction } from "@/app/metrics/admin-action";
import {
  approveSuggestion,
  ApproveSuggestionForm,
  mergeSuggestion,
  MergeSuggestionForm,
  rejectSuggestion,
  RejectSuggestionForm,
} from "@/server/admin/suggestions";

// Every admin Server Action. Each one is adminAction(page to return to, form, change).
export const approveSuggestionAction = adminAction(
  "/metrics/suggestions",
  ApproveSuggestionForm,
  approveSuggestion,
);
export const mergeSuggestionAction = adminAction(
  "/metrics/suggestions",
  MergeSuggestionForm,
  mergeSuggestion,
);
export const rejectSuggestionAction = adminAction(
  "/metrics/suggestions",
  RejectSuggestionForm,
  rejectSuggestion,
);
```

Create `apps/web/src/app/metrics/suggestions/page.tsx`:

```tsx
import { TAG_CATEGORIES } from "@mymeetingapp/shared";

import {
  approveSuggestionAction,
  mergeSuggestionAction,
  rejectSuggestionAction,
} from "@/app/metrics/actions";
import { utcTime } from "@/app/metrics/format";
import { Notice, type SearchParams } from "@/app/metrics/notice";
import { listPendingSuggestions, listRecentAiDecisions } from "@/server/admin/suggestions";
import { getActiveVocabulary } from "@/server/vocabulary";

export const dynamic = "force-dynamic";

export default async function SuggestionsPage({ searchParams }: { searchParams: SearchParams }) {
  const [pending, vocabulary, recent] = await Promise.all([
    listPendingSuggestions(),
    getActiveVocabulary(),
    listRecentAiDecisions(),
  ]);
  return (
    <>
      <h1>Suggestions</h1>
      <Notice params={await searchParams} />
      <p>
        {pending.length} waiting for review. Reviewing a suggestion removes its link to the phone that sent
        it.
      </p>
      {pending.map((suggestion) => (
        <section key={suggestion.id} className="review">
          <h2>“{suggestion.text}”</h2>
          <p className="fine-print">
            Suggested {utcTime(suggestion.createdAt)}.{" "}
            {suggestion.decisions.map((ai) => `AI (${ai.model}): ${ai.decision}, ${ai.reason}`).join(" ")}
          </p>
          <form
            action={approveSuggestionAction}
            className="inline"
            aria-label={`Add “${suggestion.text}” as a new tag`}
          >
            <input type="hidden" name="suggestionId" value={suggestion.id} />
            <label>
              Label <input name="label" defaultValue={suggestion.text} required maxLength={40} />
            </label>
            <label>
              Category{" "}
              <select name="category" defaultValue="feel">
                {TAG_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Add as a new tag</button>
          </form>
          <form
            action={mergeSuggestionAction}
            className="inline"
            aria-label={`Merge “${suggestion.text}” into a tag`}
          >
            <input type="hidden" name="suggestionId" value={suggestion.id} />
            <select name="tagSlug" aria-label="Existing tag">
              {vocabulary.map((tag) => (
                <option key={tag.slug} value={tag.slug}>
                  {tag.label}
                </option>
              ))}
            </select>
            <button type="submit" className="secondary">
              Merge
            </button>
          </form>
          <form action={rejectSuggestionAction} className="inline" aria-label={`Reject “${suggestion.text}”`}>
            <input type="hidden" name="suggestionId" value={suggestion.id} />
            <button type="submit" className="secondary">
              Reject
            </button>
          </form>
        </section>
      ))}

      <h2>Recent AI decisions</h2>
      <table>
        <thead>
          <tr>
            <th>Suggestion</th>
            <th>AI decision</th>
            <th>Reason</th>
            <th>Model</th>
            <th>Now</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((ai) => (
            <tr key={ai.id}>
              <td>{ai.input}</td>
              <td>
                {ai.decision}
                {ai.tagSlug === null ? "" : ` (${ai.tagSlug})`}
              </td>
              <td>{ai.reason}</td>
              <td>{ai.model}</td>
              <td>{ai.status}</td>
              <td>{utcTime(ai.decidedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
```

In `apps/web/src/app/metrics/layout.tsx`, add `<a href="/metrics/suggestions">Suggestions</a>` to the Admin nav.

In `docs/standards.md`, add this row:

| Concern       | The one way                                                                                                                                                                                                                                                     | Enforced by        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Admin changes | A Server Action in `src/app/metrics/actions.ts`, built with `adminAction(returnTo, Form, run)` from `@/app/metrics/admin-action`. `run` lives in `src/server/admin/*`, takes the parsed form and returns an `AdminNotice`, which the page shows with `<Notice>` | review, `*.e2e.ts` |

- [ ] **Step 7: Run the tests.** Run `pnpm --filter web exec vitest run admin-suggestions admin-notice`, then `pnpm check`, then `pnpm --filter web test:e2e`. Expected: PASS. A 303 with `?notice=` proves each part works: Next accepted the same-origin post, the action found the Basic credentials again through `headers()`, it parsed the form, and `redirect` answered.

- [ ] **Step 8: Commit.**

```bash
git add apps/web packages/shared/src/suggestions.ts docs/standards.md
git commit -m "feat(admin): weekly suggestion review with approve, merge and reject as Server Actions"
```

---

### Task 9: Swing flag review and blocking a device

**Files:**

- Create:
  - `apps/web/src/server/admin/swings.ts`
  - `apps/web/src/app/metrics/swings/page.tsx`, `apps/web/src/app/metrics/swings/[id]/page.tsx`
  - `apps/web/test/admin-swings.test.ts`, `apps/web/test/admin-swings.e2e.ts`
- Modify:
  - `apps/web/src/app/metrics/admin-action.ts`, `apps/web/src/app/metrics/actions.ts`, `apps/web/src/app/metrics/layout.tsx`
  - `apps/web/src/server/admin/notices.ts`, `docs/deploy.md` ("Blocking a device")

**Interfaces:**

- Consumes:
  - `blockDevice(deviceHash)` (Phase 3), `findOwnSubmissions(deviceHash, meetingId, executor)`, `primarySourceJoin`.
  - `RETENTION.auditDays` (Task 3), `FormId`, `adminAction` and `Notice` (Task 8), `utcTime` (Task 7).
- Produces:
  - `listOpenSwings(): Promise<Swing[]>` and `readSwingReview(id: number): Promise<SwingReview | undefined>` from `@/server/admin/swings`.
  - `blockSwingDevice(input: { swingId: number; deviceHash: string }): Promise<AdminNotice>` and `closeSwing(input: { swingId: number }): Promise<AdminNotice>`.
  - `BlockSwingDeviceForm` and `CloseSwingForm`.
  - `adminAction`'s `returnTo` may now be `(input) => string`.
  - These shapes, kept module-private (the pages use them through inference):

```ts
interface Swing {
  id: number;
  meetingId: string;
  meetingName: string;
  tagId: number;
  tagLabel: string;
  newDevices: number;
  priorDevices: number;
  flaggedAt: Date;
  reviewedAt: Date | null;
}
interface SwingDevice {
  deviceHash: string;
  blocked: boolean;
  lastAt: Date;
}
interface SwingReview {
  swing: Swing;
  devices: SwingDevice[];
}
```

- [ ] **Step 1: Write the failing tests.** Create `apps/web/test/admin-swings.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST as deleteMine } from "@/app/api/v1/tags/delete-mine/route";
import { POST as tagMeeting } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { devices, tagAudit, tagSwings } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { blockSwingDevice, closeSwing, listOpenSwings, readSwingReview } from "@/server/admin/swings";

import { resetDb } from "./db";
import {
  countsOf,
  DEVICE_A_HASH,
  DEVICE_B,
  DEVICE_B_HASH,
  deviceHeaders,
  seedMeetingStarted,
  testDevice,
} from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

async function tag(meetingId: string, slugs: string[], headers: Record<string, string>) {
  const res = await tagMeeting(
    new Request("http://test/api/v1/tags", {
      method: "POST",
      headers,
      body: JSON.stringify({ meetingId, tags: slugs }),
    }),
  );
  expect(res.status).toBe(201);
}

// A flag on "serious-tone": DEVICE_A and four more phones add it within the hour. DEVICE_B, also in the audit log,
// adds only "quiet".
async function seedSwing(): Promise<{ meetingId: string; swingId: number }> {
  const meetingId = await seedMeetingStarted(1);
  await tag(meetingId, ["serious-tone"], deviceHeaders());
  for (let n = 1; n <= 4; n++) await tag(meetingId, ["serious-tone"], deviceHeaders(testDevice(n)));
  await tag(meetingId, ["quiet"], deviceHeaders(DEVICE_B, "android"));
  const [swing] = await db.select({ id: tagSwings.id }).from(tagSwings);
  if (swing === undefined) throw new Error("no swing was flagged");
  return { meetingId, swingId: swing.id };
}

async function blocked(deviceHash: string) {
  const [row] = await db
    .select({ blocked: devices.blocked })
    .from(devices)
    .where(eq(devices.deviceHash, deviceHash));
  return row?.blocked;
}

describe("listOpenSwings", () => {
  it("lists open flags with the meeting's name and the tag's label", async () => {
    const { meetingId, swingId } = await seedSwing();
    expect(await listOpenSwings()).toMatchObject([
      {
        id: swingId,
        meetingId,
        meetingName: "Nooners",
        tagLabel: "Serious tone",
        newDevices: 5,
        priorDevices: 0,
        reviewedAt: null,
      },
    ]);
  });
});

describe("readSwingReview (spec §6)", () => {
  it("lists the phones in the 7-day audit log whose current tags on the meeting include the flagged tag", async () => {
    const { swingId } = await seedSwing();
    const review = await readSwingReview(swingId);
    const hashes = review?.devices.map((device) => device.deviceHash) ?? [];
    expect(hashes).toHaveLength(5);
    expect(hashes).toContain(DEVICE_A_HASH);
    expect(hashes).not.toContain(DEVICE_B_HASH);
    expect(review?.devices.map((device) => device.blocked)).toEqual([false, false, false, false, false]);
  });

  it("drops a device whose audit rows are over 7 days old", async () => {
    const { swingId } = await seedSwing();
    await db
      .update(tagAudit)
      .set({ at: new Date(Date.now() - 8 * 86_400_000) })
      .where(eq(tagAudit.deviceHash, DEVICE_A_HASH));
    const hashes = (await readSwingReview(swingId))?.devices.map((device) => device.deviceHash) ?? [];
    expect(hashes).toHaveLength(4);
    expect(hashes).not.toContain(DEVICE_A_HASH);
  });

  it("drops a device that deleted its data, and a stale block click does nothing", async () => {
    const { swingId } = await seedSwing();
    const res = await deleteMine(
      new Request("http://test/api/v1/tags/delete-mine", { method: "POST", headers: deviceHeaders() }),
    );
    expect(res.status).toBe(200);
    expect((await readSwingReview(swingId))?.devices.map((device) => device.deviceHash)).not.toContain(
      DEVICE_A_HASH,
    );
    expect(await blockSwingDevice({ swingId, deviceHash: DEVICE_A_HASH })).toBe("not_in_review");
  });

  it("finds nothing for a flag that doesn't exist", async () => {
    expect(await readSwingReview(999)).toBeUndefined();
    expect(await blockSwingDevice({ swingId: 999, deviceHash: DEVICE_A_HASH })).toBe("flag_not_found");
  });
});

describe("blockSwingDevice", () => {
  it("blocks a phone behind the flag, excluding its tags everywhere", async () => {
    const { meetingId, swingId } = await seedSwing();
    expect(await blockSwingDevice({ swingId, deviceHash: DEVICE_A_HASH })).toBe("blocked");
    expect(await blocked(DEVICE_A_HASH)).toBe(true);
    expect(await countsOf(meetingId)).toEqual([
      ["quiet", 1, 0],
      ["serious-tone", 4, 0],
    ]);
    const review = await readSwingReview(swingId);
    expect(review?.devices.find((device) => device.deviceHash === DEVICE_A_HASH)?.blocked).toBe(true);
  });

  it("won't block a phone that isn't behind the flag", async () => {
    const { swingId } = await seedSwing();
    expect(await blockSwingDevice({ swingId, deviceHash: DEVICE_B_HASH })).toBe("not_in_review");
    expect(await blocked(DEVICE_B_HASH)).toBe(false);
  });
});

describe("closeSwing", () => {
  it("closes an open flag once, after which it has no phones to review", async () => {
    const { swingId } = await seedSwing();
    expect(await closeSwing({ swingId })).toBe("closed");
    expect(await listOpenSwings()).toEqual([]);
    expect(await closeSwing({ swingId })).toBe("flag_not_found");
    expect((await readSwingReview(swingId))?.devices).toEqual([]);
    expect(await blockSwingDevice({ swingId, deviceHash: DEVICE_A_HASH })).toBe("not_in_review");
  });
});
```

Create `apps/web/test/admin-swings.e2e.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { POST as tagMeeting } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { devices, tagSwings } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";

import { resetDb } from "./db";
import { adminGet, formContaining, submitForm } from "./e2e-forms";
import { DEVICE_A_HASH, deviceHeaders, seedMeetingStarted, testDevice } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

async function seedSwing(): Promise<number> {
  const meetingId = await seedMeetingStarted(1);
  for (const headers of [deviceHeaders(), ...[1, 2, 3, 4].map((n) => deviceHeaders(testDevice(n)))]) {
    await tagMeeting(
      new Request("http://test/api/v1/tags", {
        method: "POST",
        headers,
        body: JSON.stringify({ meetingId, tags: ["serious-tone"] }),
      }),
    );
  }
  const [swing] = await db.select({ id: tagSwings.id }).from(tagSwings);
  if (swing === undefined) throw new Error("no swing was flagged");
  return swing.id;
}

describe("swing review in the built app", () => {
  it("blocks a phone from the flag's review page and returns to it", async () => {
    const swingId = await seedSwing();
    expect(await (await adminGet("/metrics/swings")).text()).toContain(
      `href="/metrics/swings/${String(swingId)}"`,
    );
    const path = `/metrics/swings/${String(swingId)}`;
    const html = await (await adminGet(path)).text();
    const res = await submitForm(path, formContaining(html, `Block phone ${DEVICE_A_HASH.slice(0, 12)}`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(new RegExp(`${path}\\?notice=blocked$`));
    const [row] = await db
      .select({ blocked: devices.blocked })
      .from(devices)
      .where(eq(devices.deviceHash, DEVICE_A_HASH));
    expect(row).toEqual({ blocked: true });
  });

  it("closes the flag", async () => {
    const swingId = await seedSwing();
    const path = `/metrics/swings/${String(swingId)}`;
    const res = await submitForm(
      path,
      formContaining(await (await adminGet(path)).text(), "Close this flag"),
    );
    expect(res.headers.get("location")).toMatch(/\/metrics\/swings\?notice=closed$/);
    const [row] = await db.select({ reviewedAt: tagSwings.reviewedAt }).from(tagSwings);
    expect(row?.reviewedAt).toBeInstanceOf(Date);
  });

  it("answers 404 for a flag that doesn't exist", async () => {
    expect((await adminGet("/metrics/swings/999")).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `pnpm --filter web exec vitest run admin-swings`. Expected: FAIL, because `@/server/admin/swings` doesn't exist.

- [ ] **Step 3: Implement the review.** Add to `ADMIN_NOTICES` in `apps/web/src/server/admin/notices.ts`:

```ts
  blocked: "Blocked. That phone's tags no longer count, on this meeting or any other.",
  not_in_review: "That phone isn't behind this flag (any more), so nothing was blocked.",
  closed: "Flag closed.",
  flag_not_found: "That flag is already closed or no longer exists.",
```

Create `apps/web/src/server/admin/swings.ts`:

```ts
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { devices, feedMeetings, meetings, tagAudit, tagSubmissions, tagSwings, tags } from "@/db/schema";
import { FormId } from "@/server/admin/form-fields";
import type { AdminNotice } from "@/server/admin/notices";
import { blockDevice } from "@/server/devices/block-device";
import { primarySourceJoin } from "@/server/meetings/summary";
import { RETENTION } from "@/server/retention";
import { findOwnSubmissions } from "@/server/tags/own-submissions";

export const BlockSwingDeviceForm = z.object({
  swingId: FormId,
  deviceHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export const CloseSwingForm = z.object({ swingId: FormId });

interface Swing {
  id: number;
  meetingId: string;
  meetingName: string;
  tagId: number;
  tagLabel: string;
  newDevices: number;
  priorDevices: number;
  flaggedAt: Date;
  reviewedAt: Date | null;
}

interface SwingDevice {
  deviceHash: string;
  blocked: boolean;
  lastAt: Date;
}

interface SwingReview {
  swing: Swing;
  devices: SwingDevice[];
}

function selectSwings() {
  return db
    .select({
      id: tagSwings.id,
      meetingId: tagSwings.meetingId,
      meetingName: sql<string>`coalesce(${feedMeetings.name}, 'Unnamed meeting')`,
      tagId: tagSwings.tagId,
      tagLabel: tags.label,
      newDevices: tagSwings.newDevices,
      priorDevices: tagSwings.priorDevices,
      flaggedAt: tagSwings.flaggedAt,
      reviewedAt: tagSwings.reviewedAt,
    })
    .from(tagSwings)
    .innerJoin(tags, eq(tags.id, tagSwings.tagId))
    .innerJoin(meetings, eq(meetings.id, tagSwings.meetingId))
    .leftJoin(feedMeetings, primarySourceJoin)
    .$dynamic();
}

export async function listOpenSwings(): Promise<Swing[]> {
  return selectSwings()
    .where(isNull(tagSwings.reviewedAt))
    .orderBy(desc(tagSwings.flaggedAt), desc(tagSwings.id));
}

// Whether the device's current row on the meeting, under any merged-away scope, includes the tag.
async function holdsTag(deviceHash: string, meetingId: string, tagId: number): Promise<boolean> {
  const own = await findOwnSubmissions(deviceHash, meetingId, db);
  if (own.length === 0) return false;
  const holding = await db
    .select({ submitterId: tagSubmissions.submitterId })
    .from(tagSubmissions)
    .where(
      and(
        eq(tagSubmissions.meetingId, meetingId),
        inArray(
          tagSubmissions.submitterId,
          own.map((row) => row.submitterId),
        ),
        sql`${tagId} = any(${tagSubmissions.tagIds})`,
      ),
    );
  return holding.length > 0;
}

// Spec §6: the phones behind a flag are those the 7-day audit log shows writing to this meeting whose current tags
// on it include the flagged tag. This lists phones for one meeting only. Nothing lists a phone's meetings (spec §2).
async function swingDevices(swing: Swing): Promise<SwingDevice[]> {
  const audited = await db
    .select({
      deviceHash: tagAudit.deviceHash,
      blocked: sql<boolean>`coalesce(bool_or(${devices.blocked}), false)`,
      lastAt: sql`max(${tagAudit.at})`.mapWith(tagAudit.at),
    })
    .from(tagAudit)
    .leftJoin(devices, eq(devices.deviceHash, tagAudit.deviceHash))
    .where(
      and(
        eq(tagAudit.meetingId, swing.meetingId),
        gt(tagAudit.at, sql`now() - make_interval(days => ${RETENTION.auditDays}::int)`),
      ),
    )
    .groupBy(tagAudit.deviceHash)
    .orderBy(desc(sql`max(${tagAudit.at})`));
  const behind: SwingDevice[] = [];
  for (const row of audited) {
    if (await holdsTag(row.deviceHash, swing.meetingId, swing.tagId)) behind.push(row);
  }
  return behind;
}

// A closed flag has nothing left to act on, so it lists no phones.
export async function readSwingReview(id: number): Promise<SwingReview | undefined> {
  const [swing] = await selectSwings().where(eq(tagSwings.id, id));
  if (swing === undefined) return undefined;
  return { swing, devices: swing.reviewedAt === null ? await swingDevices(swing) : [] };
}

// The hash comes from the review page's form, so it's checked against the review again before anything is blocked.
export async function blockSwingDevice(input: z.output<typeof BlockSwingDeviceForm>): Promise<AdminNotice> {
  const review = await readSwingReview(input.swingId);
  if (review === undefined) return "flag_not_found";
  if (!review.devices.some((device) => device.deviceHash === input.deviceHash)) return "not_in_review";
  await blockDevice(input.deviceHash);
  return "blocked";
}

export async function closeSwing(input: z.output<typeof CloseSwingForm>): Promise<AdminNotice> {
  const closed = await db
    .update(tagSwings)
    .set({ reviewedAt: sql`now()` })
    .where(and(eq(tagSwings.id, input.swingId), isNull(tagSwings.reviewedAt)))
    .returning({ id: tagSwings.id });
  return closed.length > 0 ? "closed" : "flag_not_found";
}
```

- [ ] **Step 4: Run them and watch them pass.** Run `pnpm --filter web exec vitest run admin-swings block-device`. Expected: PASS.

- [ ] **Step 5: Wire the pages and actions.** In `apps/web/src/app/metrics/admin-action.ts`, let the page to return to depend on the form, so a review page returns to itself:

```ts
export function adminAction<Schema extends z.ZodType>(
  returnTo: string | ((input: z.output<Schema>) => string),
  schema: Schema,
  run: (input: z.output<Schema>) => Promise<AdminNotice>,
): (formData: FormData) => Promise<never> {
  return async (formData) => {
    if (!isAdminAuthorization((await headers()).get("authorization"))) throw new Error("Not signed in");
    const parsed = schema.safeParse(Object.fromEntries(formData));
    // A form that doesn't parse can't say which record it was for, so it goes back to the overview.
    if (!parsed.success)
      redirect(`${typeof returnTo === "string" ? returnTo : "/metrics"}?notice=invalid_form`);
    const notice = await run(parsed.data);
    redirect(`${typeof returnTo === "string" ? returnTo : returnTo(parsed.data)}?notice=${notice}`);
  };
}
```

Add to `apps/web/src/app/metrics/actions.ts`:

```ts
import { blockSwingDevice, BlockSwingDeviceForm, closeSwing, CloseSwingForm } from "@/server/admin/swings";

export const blockSwingDeviceAction = adminAction(
  (input) => `/metrics/swings/${String(input.swingId)}`,
  BlockSwingDeviceForm,
  blockSwingDevice,
);
export const closeSwingAction = adminAction("/metrics/swings", CloseSwingForm, closeSwing);
```

Create `apps/web/src/app/metrics/swings/page.tsx`:

```tsx
import { utcTime } from "@/app/metrics/format";
import { Notice, type SearchParams } from "@/app/metrics/notice";
import { listOpenSwings } from "@/server/admin/swings";

export const dynamic = "force-dynamic";

export default async function SwingsPage({ searchParams }: { searchParams: SearchParams }) {
  const swings = await listOpenSwings();
  return (
    <>
      <h1>Swing flags</h1>
      <Notice params={await searchParams} />
      <p>
        A flag means one tag suddenly gained 5 or more new phones on a meeting that had fewer than 10. Nothing
        is blocked automatically.
      </p>
      {swings.length === 0 ? (
        <p>No open flags.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Meeting</th>
              <th>Tag</th>
              <th>New / earlier phones</th>
              <th>Flagged</th>
            </tr>
          </thead>
          <tbody>
            {swings.map((swing) => (
              <tr key={swing.id}>
                <td>
                  <a href={`/metrics/swings/${String(swing.id)}`}>{swing.meetingName}</a>
                </td>
                <td>{swing.tagLabel}</td>
                <td>
                  {swing.newDevices} / {swing.priorDevices}
                </td>
                <td>{utcTime(swing.flaggedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
```

Create `apps/web/src/app/metrics/swings/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";

import { blockSwingDeviceAction, closeSwingAction } from "@/app/metrics/actions";
import { utcTime } from "@/app/metrics/format";
import { Notice, type SearchParams } from "@/app/metrics/notice";
import { FormId } from "@/server/admin/form-fields";
import { readSwingReview } from "@/server/admin/swings";
import { RETENTION } from "@/server/retention";

export const dynamic = "force-dynamic";

// Spec §6: the one admin page that shows anything per phone, and only the phones behind one meeting's flag.
export default async function SwingReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const id = FormId.safeParse((await params).id);
  const review = id.success ? await readSwingReview(id.data) : undefined;
  if (review === undefined) notFound();
  const { swing, devices } = review;
  return (
    <>
      <h1>
        {swing.tagLabel} on {swing.meetingName}
      </h1>
      <Notice params={await searchParams} />
      <p>
        {swing.newDevices} new phones in 48 hours, {swing.priorDevices} before. Flagged{" "}
        {utcTime(swing.flaggedAt)}
        {swing.reviewedAt === null ? "." : `, closed ${utcTime(swing.reviewedAt)}.`}
      </p>
      <h2>Phones behind it</h2>
      <p className="fine-print">
        From the abuse-review log, which keeps a phone&apos;s link to a meeting for {RETENTION.auditDays}{" "}
        days. Only phones whose current tags here include “{swing.tagLabel}” are listed.
      </p>
      {devices.length === 0 ? (
        <p>None left to review.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Phone</th>
              <th>Last change</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.deviceHash}>
                <td>
                  <code>{device.deviceHash.slice(0, 12)}…</code>
                </td>
                <td>{utcTime(device.lastAt)}</td>
                <td>
                  {device.blocked ? (
                    "Blocked"
                  ) : (
                    <form
                      action={blockSwingDeviceAction}
                      className="inline"
                      aria-label={`Block phone ${device.deviceHash.slice(0, 12)}`}
                    >
                      <input type="hidden" name="swingId" value={swing.id} />
                      <input type="hidden" name="deviceHash" value={device.deviceHash} />
                      <button type="submit">Block</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {swing.reviewedAt === null ? (
        <form action={closeSwingAction} aria-label="Close this flag">
          <input type="hidden" name="swingId" value={swing.id} />
          <button type="submit" className="secondary">
            Close this flag
          </button>
        </form>
      ) : null}
    </>
  );
}
```

In `apps/web/src/app/metrics/layout.tsx`, add `<a href="/metrics/swings">Swing flags</a>` to the Admin nav. In `docs/deploy.md` "Blocking a device", add first: "Normally, block from `/metrics/swings`: open the flag, then choose Block next to each phone behind it. The CLI below does the same thing and stays for when the site is down."

- [ ] **Step 6: Run the tests.** Run `pnpm check`, then `pnpm --filter web test:e2e`. Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/web docs/deploy.md
git commit -m "feat(admin): review swing flags with their 7-day audit rows, block a phone, close a flag"
```

---

### Task 10: Group and feed opt-outs

**Files:**

- Create:
  - `apps/web/src/server/admin/opt-outs.ts`, `apps/web/src/app/metrics/opt-outs/page.tsx`
  - `apps/web/test/admin-opt-outs.test.ts`, `apps/web/test/admin-opt-outs.e2e.ts`
- Modify:
  - `apps/web/src/server/admin/form-fields.ts`, `apps/web/src/server/admin/notices.ts`
  - `apps/web/src/app/metrics/actions.ts`, `apps/web/src/app/metrics/layout.tsx`

**Interfaces:**

- Consumes: `primarySourceJoin`, `FormId`, `adminAction`, `Notice` (Task 8), and the test fixtures `seedMeetingStarted`, `elsewhere`, `seedFeed`, `deviceHeaders` and `feedMeeting`.
- Produces:
  - `FormBoolean` (zod: `"true"`/`"false"` to a boolean) from `@/server/admin/form-fields`. Task 11 uses it.
  - From `@/server/admin/opt-outs`:
    - `findMeetings(query: string): Promise<MeetingMatch[]>` and `listTagOptOuts(): Promise<MeetingMatch[]>`;
    - `setMeetingTagsDisabled(input: { meetingId: string; tagsDisabled: boolean }): Promise<AdminNotice>`;
    - `findFeeds(query: string): Promise<FeedMatch[]>` and `listOptedOutFeeds(): Promise<FeedMatch[]>`;
    - `setFeedOptedOut(input: { feedId: number; optedOut: boolean }): Promise<AdminNotice>`;
    - `MeetingOptOutForm` and `FeedOptOutForm`.

```ts
export interface MeetingMatch {
  id: string;
  name: string;
  day: number;
  time: string;
  address: string | null;
  tagsDisabled: boolean;
}
export interface FeedMatch {
  id: number;
  slug: string;
  name: string;
  state: string;
  optedOut: boolean;
}
```

- [ ] **Step 1: Write the failing tests.** Create `apps/web/test/admin-opt-outs.test.ts`:

```ts
import { MeetingDetailResponse } from "@mymeetingapp/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getMeeting } from "@/app/api/v1/meetings/[id]/route";
import { POST as tagMeeting } from "@/app/api/v1/tags/route";
import { db, pool } from "@/db/client";
import { feeds, meetings } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import {
  findFeeds,
  findMeetings,
  listOptedOutFeeds,
  listTagOptOuts,
  MeetingOptOutForm,
  setFeedOptedOut,
  setMeetingTagsDisabled,
} from "@/server/admin/opt-outs";

import { resetDb } from "./db";
import { seedFeed } from "./feed-fixtures";
import { deviceHeaders, elsewhere, seedMeetingStarted } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

function tag(meetingId: string) {
  return tagMeeting(
    new Request("http://test/api/v1/tags", {
      method: "POST",
      headers: deviceHeaders(),
      body: JSON.stringify({ meetingId, tags: ["quiet"] }),
    }),
  );
}

async function detail(meetingId: string) {
  const res = await getMeeting(new Request(`http://test/api/v1/meetings/${meetingId}`), {
    params: Promise.resolve({ id: meetingId }),
  });
  return MeetingDetailResponse.parse(await res.json()).meeting;
}

describe("findMeetings", () => {
  it("matches the name, group name or address, taking % and _ literally", async () => {
    await seedMeetingStarted(1, { ...elsewhere(1), name: "100% Sober" });
    await seedMeetingStarted(1, { ...elsewhere(2), name: "1000 Club" });
    await seedMeetingStarted(1, { ...elsewhere(3), name: "Nooners", groupName: "Serenity Group" });
    expect((await findMeetings("100%")).map((meeting) => meeting.name)).toEqual(["100% Sober"]);
    expect((await findMeetings("serenity")).map((meeting) => meeting.name)).toEqual(["Nooners"]);
    expect((await findMeetings("2 Elm")).map((meeting) => meeting.name)).toEqual(["1000 Club"]);
    expect(await findMeetings("1_00")).toEqual([]);
  });
});

describe("setMeetingTagsDisabled (spec §3)", () => {
  it("turns tags off for a group, so none are accepted or shown, and back on", async () => {
    const meetingId = await seedMeetingStarted(1);
    expect((await tag(meetingId)).status).toBe(201);

    expect(await setMeetingTagsDisabled({ meetingId, tagsDisabled: true })).toBe("tags_turned_off");
    expect(await detail(meetingId)).toMatchObject({ tagsDisabled: true, tags: [] });
    const refused = await tag(meetingId);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: "tags_disabled" } });
    expect((await listTagOptOuts()).map((meeting) => meeting.id)).toEqual([meetingId]);

    expect(await setMeetingTagsDisabled({ meetingId, tagsDisabled: false })).toBe("tags_turned_on");
    expect(await detail(meetingId)).toMatchObject({
      tagsDisabled: false,
      tags: [{ slug: "quiet", count: 1 }],
    });
    expect(await listTagOptOuts()).toEqual([]);
  });

  it("says so when the meeting no longer exists", async () => {
    expect(
      await setMeetingTagsDisabled({ meetingId: "0b6c9c1e-5f0a-4a57-9a51-1d8c2f0e7a11", tagsDisabled: true }),
    ).toBe("meeting_not_found");
  });
});

describe("MeetingOptOutForm", () => {
  it("reads the hidden fields", () => {
    expect(
      MeetingOptOutForm.parse({ meetingId: "0b6c9c1e-5f0a-4a57-9a51-1d8c2f0e7a11", tagsDisabled: "true" }),
    ).toEqual({ meetingId: "0b6c9c1e-5f0a-4a57-9a51-1d8c2f0e7a11", tagsDisabled: true });
    expect(
      MeetingOptOutForm.safeParse({ meetingId: "0b6c9c1e-5f0a-4a57-9a51-1d8c2f0e7a11", tagsDisabled: "yes" })
        .success,
    ).toBe(false);
  });
});

describe("feed opt-outs (spec §3, §4)", () => {
  it("finds a feed by name, slug or address", async () => {
    await seedFeed("knox-intergroup");
    await seedFeed("memphis-area", "area");
    expect((await findFeeds("knox")).map((feed) => feed.slug)).toEqual(["knox-intergroup"]);
    expect((await findFeeds("memphis-area.example.org")).map((feed) => feed.slug)).toEqual(["memphis-area"]);
  });

  it("opts a feed out, then back in, making it due for a full fetch", async () => {
    const feedId = await seedFeed("knox-intergroup");
    await db
      .update(feeds)
      .set({ lastSuccessAt: new Date(), lastAttemptAt: new Date() })
      .where(eq(feeds.id, feedId));

    expect(await setFeedOptedOut({ feedId, optedOut: true })).toBe("feed_opted_out");
    expect((await listOptedOutFeeds()).map((feed) => feed.slug)).toEqual(["knox-intergroup"]);

    expect(await setFeedOptedOut({ feedId, optedOut: false })).toBe("feed_opted_in");
    const [row] = await db
      .select({
        optedOut: feeds.optedOut,
        lastSuccessAt: feeds.lastSuccessAt,
        lastAttemptAt: feeds.lastAttemptAt,
      })
      .from(feeds)
      .where(eq(feeds.id, feedId));
    expect(row).toEqual({ optedOut: false, lastSuccessAt: null, lastAttemptAt: null });
  });

  it("says so when the feed no longer exists", async () => {
    expect(await setFeedOptedOut({ feedId: 999, optedOut: true })).toBe("feed_not_found");
  });
});

describe("archived meetings", () => {
  it("aren't offered by the search", async () => {
    const meetingId = await seedMeetingStarted(1);
    await db.update(meetings).set({ archivedAt: new Date() }).where(eq(meetings.id, meetingId));
    expect(await findMeetings("Nooners")).toEqual([]);
  });
});
```

Create `apps/web/test/admin-opt-outs.e2e.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { meetings } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";

import { resetDb } from "./db";
import { adminGet, formContaining, submitForm } from "./e2e-forms";
import { seedMeetingStarted } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

describe("opt-outs in the built app", () => {
  it("finds a meeting and turns its tags off", async () => {
    const meetingId = await seedMeetingStarted(1);
    const html = await (await adminGet("/metrics/opt-outs?q=Nooners")).text();
    const res = await submitForm("/metrics/opt-outs", formContaining(html, "Turn tags off for Nooners"));
    expect(res.headers.get("location")).toMatch(/\/metrics\/opt-outs\?notice=tags_turned_off$/);
    const [row] = await db
      .select({ tagsDisabled: meetings.tagsDisabled })
      .from(meetings)
      .where(eq(meetings.id, meetingId));
    expect(row).toEqual({ tagsDisabled: true });
    expect(await (await adminGet("/metrics/opt-outs")).text()).toContain("Turn tags back on for Nooners");
  });
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `pnpm --filter web exec vitest run admin-opt-outs`. Expected: FAIL, because `@/server/admin/opt-outs` doesn't exist.

- [ ] **Step 3: Implement.** Add to `apps/web/src/server/admin/form-fields.ts`:

```ts
// A hidden "true" or "false".
export const FormBoolean = z.enum(["true", "false"]).transform((value) => value === "true");
```

Add to `ADMIN_NOTICES`:

```ts
  tags_turned_off: "Tags are off for that meeting: none are accepted or shown. The app catches up within 5 minutes.",
  tags_turned_on: "Tags are back on for that meeting.",
  meeting_not_found: "That meeting no longer exists. Search for it again.",
  feed_opted_out: "Feed opted out. Its meetings leave the app at the next sync, within 15 minutes.",
  feed_opted_in: "Feed opted back in. It's fetched at the next sync.",
  feed_not_found: "That feed no longer exists.",
```

Create `apps/web/src/server/admin/opt-outs.ts`:

```ts
import { and, asc, eq, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { feedMeetings, feeds, meetings } from "@/db/schema";
import { FormBoolean, FormId } from "@/server/admin/form-fields";
import type { AdminNotice } from "@/server/admin/notices";
import { primarySourceJoin } from "@/server/meetings/summary";

const SEARCH_LIMIT = 25;

export const MeetingOptOutForm = z.object({ meetingId: z.uuid(), tagsDisabled: FormBoolean });
export const FeedOptOutForm = z.object({ feedId: FormId, optedOut: FormBoolean });

export interface MeetingMatch {
  id: string;
  name: string;
  day: number;
  time: string;
  address: string | null;
  tagsDisabled: boolean;
}

export interface FeedMatch {
  id: number;
  slug: string;
  name: string;
  state: string;
  optedOut: boolean;
}

// What the owner typed, matched anywhere, with LIKE's own wildcards taken literally.
function containing(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, "\\$&")}%`;
}

const meetingColumns = {
  id: meetings.id,
  name: feedMeetings.name,
  day: meetings.day,
  time: meetings.time,
  address: feedMeetings.formattedAddress,
  tagsDisabled: meetings.tagsDisabled,
};

// A group asks by name, day, time and address (the support page says so), so this matches the meeting's name, its
// group's name or its address. Meetings aren't people, so listing them is fine.
export async function findMeetings(query: string): Promise<MeetingMatch[]> {
  const pattern = containing(query);
  return db
    .select(meetingColumns)
    .from(meetings)
    .innerJoin(feedMeetings, primarySourceJoin)
    .where(
      and(
        isNull(meetings.archivedAt),
        or(
          ilike(feedMeetings.name, pattern),
          ilike(feedMeetings.groupName, pattern),
          ilike(feedMeetings.formattedAddress, pattern),
        ),
      ),
    )
    .orderBy(asc(feedMeetings.name), asc(meetings.day), asc(meetings.time))
    .limit(SEARCH_LIMIT);
}

export async function listTagOptOuts(): Promise<MeetingMatch[]> {
  return db
    .select(meetingColumns)
    .from(meetings)
    .innerJoin(feedMeetings, primarySourceJoin)
    .where(eq(meetings.tagsDisabled, true))
    .orderBy(asc(feedMeetings.name), asc(meetings.day), asc(meetings.time));
}

// Spec §3: a group that asked not to be tagged. No tag is accepted or shown while this is set. Its rows stay, so
// turning tags back on shows the counts again.
export async function setMeetingTagsDisabled(
  input: z.output<typeof MeetingOptOutForm>,
): Promise<AdminNotice> {
  const updated = await db
    .update(meetings)
    .set({ tagsDisabled: input.tagsDisabled })
    .where(eq(meetings.id, input.meetingId))
    .returning({ id: meetings.id });
  if (updated.length === 0) return "meeting_not_found";
  return input.tagsDisabled ? "tags_turned_off" : "tags_turned_on";
}

const feedColumns = {
  id: feeds.id,
  slug: feeds.slug,
  name: feeds.name,
  state: feeds.state,
  optedOut: feeds.optedOut,
};

// An entity writes with its website, so the feed's address is searched too.
export async function findFeeds(query: string): Promise<FeedMatch[]> {
  const pattern = containing(query);
  return db
    .select(feedColumns)
    .from(feeds)
    .where(or(ilike(feeds.name, pattern), ilike(feeds.slug, pattern), ilike(feeds.url, pattern)))
    .orderBy(asc(feeds.name))
    .limit(SEARCH_LIMIT);
}

export async function listOptedOutFeeds(): Promise<FeedMatch[]> {
  return db.select(feedColumns).from(feeds).where(eq(feeds.optedOut, true)).orderBy(asc(feeds.name));
}

// Spec §3 and §4: an entity that asked us to stop using its feed. The next sync (every 15 minutes) archives its
// meetings. Opting back in makes the feed due at once.
export async function setFeedOptedOut(input: z.output<typeof FeedOptOutForm>): Promise<AdminNotice> {
  const updated = await db
    .update(feeds)
    .set(input.optedOut ? { optedOut: true } : { optedOut: false, lastSuccessAt: null, lastAttemptAt: null })
    .where(eq(feeds.id, input.feedId))
    .returning({ id: feeds.id });
  if (updated.length === 0) return "feed_not_found";
  return input.optedOut ? "feed_opted_out" : "feed_opted_in";
}
```

- [ ] **Step 4: Run them and watch them pass.** Run `pnpm --filter web exec vitest run admin-opt-outs`. Expected: PASS.

- [ ] **Step 5: Wire the page and actions.** Add to `apps/web/src/app/metrics/actions.ts`:

```ts
import {
  FeedOptOutForm,
  MeetingOptOutForm,
  setFeedOptedOut,
  setMeetingTagsDisabled,
} from "@/server/admin/opt-outs";

export const setMeetingTagsAction = adminAction(
  "/metrics/opt-outs",
  MeetingOptOutForm,
  setMeetingTagsDisabled,
);
export const setFeedOptOutAction = adminAction("/metrics/opt-outs", FeedOptOutForm, setFeedOptedOut);
```

Create `apps/web/src/app/metrics/opt-outs/page.tsx`:

```tsx
import { setFeedOptOutAction, setMeetingTagsAction } from "@/app/metrics/actions";
import { Notice, type SearchParams } from "@/app/metrics/notice";
import {
  type FeedMatch,
  findFeeds,
  findMeetings,
  listOptedOutFeeds,
  listTagOptOuts,
  type MeetingMatch,
} from "@/server/admin/opt-outs";

export const dynamic = "force-dynamic";

// Meeting Guide numbers days from Sunday.
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MIN_QUERY = 2;

const dayName = (day: number) => DAYS[day] ?? "Unknown day";

function MeetingRows({ meetings }: { meetings: MeetingMatch[] }) {
  if (meetings.length === 0) return null;
  return (
    <table>
      <tbody>
        {meetings.map((meeting) => {
          const action = meeting.tagsDisabled ? "Turn tags back on" : "Turn tags off";
          return (
            <tr key={meeting.id}>
              <td>{meeting.name}</td>
              <td>
                {dayName(meeting.day)} {meeting.time}
              </td>
              <td>{meeting.address ?? "Online"}</td>
              <td>
                <form
                  action={setMeetingTagsAction}
                  className="inline"
                  aria-label={`${action} for ${meeting.name}, ${dayName(meeting.day)} ${meeting.time}`}
                >
                  <input type="hidden" name="meetingId" value={meeting.id} />
                  <input type="hidden" name="tagsDisabled" value={meeting.tagsDisabled ? "false" : "true"} />
                  <button type="submit" className={meeting.tagsDisabled ? "secondary" : undefined}>
                    {action}
                  </button>
                </form>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FeedRows({ feeds }: { feeds: FeedMatch[] }) {
  if (feeds.length === 0) return null;
  return (
    <table>
      <tbody>
        {feeds.map((feed) => {
          const action = feed.optedOut ? "Opt back in" : "Opt out";
          return (
            <tr key={feed.id}>
              <td>
                {feed.name} ({feed.slug}, {feed.state})
              </td>
              <td>
                <form action={setFeedOptOutAction} className="inline" aria-label={`${action}: ${feed.name}`}>
                  <input type="hidden" name="feedId" value={feed.id} />
                  <input type="hidden" name="optedOut" value={feed.optedOut ? "false" : "true"} />
                  <button type="submit" className={feed.optedOut ? "secondary" : undefined}>
                    {action}
                  </button>
                </form>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function OptOutsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const meetingQuery = typeof params.q === "string" ? params.q.trim() : "";
  const feedQuery = typeof params.feed === "string" ? params.feed.trim() : "";
  const [meetingsFound, tagsOff, feedsFound, feedsOut] = await Promise.all([
    meetingQuery.length >= MIN_QUERY ? findMeetings(meetingQuery) : [],
    listTagOptOuts(),
    feedQuery.length >= MIN_QUERY ? findFeeds(feedQuery) : [],
    listOptedOutFeeds(),
  ]);
  return (
    <>
      <h1>Opt-outs</h1>
      <Notice params={params} />

      <h2>Groups: tags off</h2>
      <p>For a group that asked not to be tagged. No tags are accepted or shown for its meeting.</p>
      <form method="get" action="/metrics/opt-outs" className="inline" role="search">
        <label>
          Meeting name, group or address <input name="q" defaultValue={meetingQuery} minLength={MIN_QUERY} />
        </label>
        <button type="submit" className="secondary">
          Find
        </button>
      </form>
      <MeetingRows meetings={meetingsFound} />
      <h3>Tags off now</h3>
      {tagsOff.length === 0 ? <p>None.</p> : <MeetingRows meetings={tagsOff} />}

      <h2>Feeds: opted out</h2>
      <p>
        For an intergroup or service entity that asked us to stop using its list. Also add{" "}
        <code>opted_out: true</code> to its entry in <code>tools/feed-discovery/registry.yaml</code>.
      </p>
      <form method="get" action="/metrics/opt-outs" className="inline" role="search">
        <label>
          Feed name, slug or website <input name="feed" defaultValue={feedQuery} minLength={MIN_QUERY} />
        </label>
        <button type="submit" className="secondary">
          Find
        </button>
      </form>
      <FeedRows feeds={feedsFound} />
      <h3>Opted out now</h3>
      {feedsOut.length === 0 ? <p>None.</p> : <FeedRows feeds={feedsOut} />}
    </>
  );
}
```

In `apps/web/src/app/metrics/layout.tsx`, add `<a href="/metrics/opt-outs">Opt-outs</a>` to the Admin nav.

- [ ] **Step 6: Run the tests.** Run `pnpm check`, then `pnpm --filter web test:e2e`. Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/web
git commit -m "feat(admin): turn tags off for a group and opt feeds out or back in"
```

---

### Task 11: Retiring and restoring tags

**Files:**

- Create:
  - `apps/web/src/server/admin/vocabulary.ts`, `apps/web/src/app/metrics/vocabulary/page.tsx`
  - `apps/web/test/admin-vocabulary.test.ts`, `apps/web/test/admin-vocabulary.e2e.ts`
- Modify:
  - `apps/web/src/server/vocabulary.ts`, `apps/web/src/server/admin/notices.ts`
  - `apps/web/src/app/metrics/actions.ts`, `apps/web/src/app/metrics/layout.tsx`

**Interfaces:**

- Consumes: `FormId`, `FormBoolean`, `adminAction`, `Notice` (Tasks 8 and 10), `getActiveVocabulary`.
- Produces:
  - `VOCABULARY_ORDER` from `@/server/vocabulary`.
  - `listVocabulary(): Promise<{ id: number; slug: string; label: string; category: string; status: "active" | "retired" }[]>`, `setTagRetired(input: { tagId: number; retired: boolean }): Promise<AdminNotice>` and `TagStatusForm` from `@/server/admin/vocabulary`.

- [ ] **Step 1: Write the failing tests.** Create `apps/web/test/admin-vocabulary.test.ts`:

```ts
import { MeetingDetailResponse, VocabularyResponse } from "@mymeetingapp/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { GET as getMeeting } from "@/app/api/v1/meetings/[id]/route";
import { GET as getVocabulary } from "@/app/api/v1/vocabulary/route";
import { db, pool } from "@/db/client";
import { tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";
import { listVocabulary, setTagRetired } from "@/server/admin/vocabulary";
import { recountTags } from "@/server/tags/counts";

import { resetDb } from "./db";
import { countsOf, insertSubmission, seedMeetingStarted } from "./tag-fixtures";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

async function quiet() {
  const [row] = await db.select().from(tags).where(eq(tags.slug, "quiet"));
  if (row === undefined) throw new Error("no quiet tag");
  return row;
}

async function vocabularySlugs(): Promise<string[]> {
  const res = await getVocabulary(new Request("http://test/api/v1/vocabulary"));
  return VocabularyResponse.parse(await res.json()).tags.map((tag) => tag.slug);
}

async function meetingTags(meetingId: string) {
  const res = await getMeeting(new Request(`http://test/api/v1/meetings/${meetingId}`), {
    params: Promise.resolve({ id: meetingId }),
  });
  return MeetingDetailResponse.parse(await res.json()).meeting.tags;
}

async function taggedQuietly(): Promise<string> {
  const meetingId = await seedMeetingStarted(1);
  await insertSubmission(meetingId, ["quiet"]);
  await recountTags([meetingId], db);
  return meetingId;
}

describe("setTagRetired (spec §5: retired, never deleted)", () => {
  it("hides a retired tag from the app, keeping its row and its counts", async () => {
    const meetingId = await taggedQuietly();
    expect(await setTagRetired({ tagId: (await quiet()).id, retired: true })).toBe("tag_retired");
    expect(await vocabularySlugs()).not.toContain("quiet");
    expect(await meetingTags(meetingId)).toEqual([]);
    expect(await countsOf(meetingId)).toEqual([["quiet", 1, 0]]);
    expect(await quiet()).toMatchObject({ status: "retired" });
  });

  it("restores it with its counts", async () => {
    const meetingId = await taggedQuietly();
    await setTagRetired({ tagId: (await quiet()).id, retired: true });
    expect(await setTagRetired({ tagId: (await quiet()).id, retired: false })).toBe("tag_restored");
    expect(await vocabularySlugs()).toContain("quiet");
    expect(await meetingTags(meetingId)).toEqual([{ slug: "quiet", count: 1 }]);
  });

  it("says so when the tag doesn't exist", async () => {
    expect(await setTagRetired({ tagId: 999, retired: true })).toBe("tag_not_found");
  });
});

describe("listVocabulary", () => {
  it("lists every tag, retired ones included, in vocabulary order", async () => {
    await setTagRetired({ tagId: (await quiet()).id, retired: true });
    const vocabulary = await listVocabulary();
    expect(vocabulary).toHaveLength(26);
    expect(vocabulary.slice(0, 2).map((tag) => tag.slug)).toEqual(["by-the-book", "laid-back"]);
    expect(vocabulary.find((tag) => tag.slug === "quiet")?.status).toBe("retired");
  });
});
```

Create `apps/web/test/admin-vocabulary.e2e.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool } from "@/db/client";
import { tags } from "@/db/schema";
import { seedVocabulary } from "@/db/seed-vocabulary";

import { resetDb } from "./db";
import { adminGet, formContaining, submitForm } from "./e2e-forms";

beforeEach(async () => {
  await resetDb();
  await seedVocabulary();
});
afterAll(() => pool.end());

describe("the vocabulary in the built app", () => {
  it("retires a tag from its form", async () => {
    const html = await (await adminGet("/metrics/vocabulary")).text();
    const res = await submitForm("/metrics/vocabulary", formContaining(html, "Retire “Quiet”"));
    expect(res.headers.get("location")).toMatch(/\/metrics\/vocabulary\?notice=tag_retired$/);
    const [row] = await db.select({ status: tags.status }).from(tags).where(eq(tags.slug, "quiet"));
    expect(row).toEqual({ status: "retired" });
  });
});
```

- [ ] **Step 2: Run them and watch them fail.** Run `pnpm --filter web exec vitest run admin-vocabulary`. Expected: FAIL, because `@/server/admin/vocabulary` doesn't exist.

- [ ] **Step 3: Implement.** In `apps/web/src/server/vocabulary.ts`, move the ordering into an export and use it:

```ts
// Categories in TAG_CATEGORIES order, then each tag's place in its list: how the app and the admin show the
// vocabulary.
export const VOCABULARY_ORDER = [
  sql`array_position(array[${sqlStringList(TAG_CATEGORIES)}]::text[], ${tags.category})`,
  asc(tags.sortOrder),
  asc(tags.slug),
];

export async function getActiveVocabulary() {
  return db
    .select({ slug: tags.slug, label: tags.label, category: tags.category })
    .from(tags)
    .where(eq(tags.status, "active"))
    .orderBy(...VOCABULARY_ORDER);
}
```

Add to `ADMIN_NOTICES`:

```ts
  tag_retired: "Retired. The app stops offering it within an hour, and its counts are kept.",
  tag_restored: "Restored. The app offers it again within an hour.",
```

Create `apps/web/src/server/admin/vocabulary.ts`:

```ts
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { tags } from "@/db/schema";
import { FormBoolean, FormId } from "@/server/admin/form-fields";
import type { AdminNotice } from "@/server/admin/notices";
import { VOCABULARY_ORDER } from "@/server/vocabulary";

export const TagStatusForm = z.object({ tagId: FormId, retired: FormBoolean });

export async function listVocabulary() {
  return db
    .select({ id: tags.id, slug: tags.slug, label: tags.label, category: tags.category, status: tags.status })
    .from(tags)
    .orderBy(...VOCABULARY_ORDER);
}

// Spec §5: a tag is retired (hidden in the app, its counts kept) or restored, never deleted.
export async function setTagRetired(input: z.output<typeof TagStatusForm>): Promise<AdminNotice> {
  const updated = await db
    .update(tags)
    .set({ status: input.retired ? "retired" : "active" })
    .where(eq(tags.id, input.tagId))
    .returning({ id: tags.id });
  if (updated.length === 0) return "tag_not_found";
  return input.retired ? "tag_retired" : "tag_restored";
}
```

- [ ] **Step 4: Run them and watch them pass.** Run `pnpm --filter web exec vitest run admin-vocabulary vocabulary-route`. Expected: PASS.

- [ ] **Step 5: Wire the page and action.** Add to `apps/web/src/app/metrics/actions.ts`:

```ts
import { setTagRetired, TagStatusForm } from "@/server/admin/vocabulary";

export const setTagRetiredAction = adminAction("/metrics/vocabulary", TagStatusForm, setTagRetired);
```

Create `apps/web/src/app/metrics/vocabulary/page.tsx`:

```tsx
import { setTagRetiredAction } from "@/app/metrics/actions";
import { Notice, type SearchParams } from "@/app/metrics/notice";
import { listVocabulary } from "@/server/admin/vocabulary";

export const dynamic = "force-dynamic";

export default async function VocabularyPage({ searchParams }: { searchParams: SearchParams }) {
  const vocabulary = await listVocabulary();
  return (
    <>
      <h1>Vocabulary</h1>
      <Notice params={await searchParams} />
      <p>
        Retiring a tag hides it in the app and keeps its counts. Tags are never deleted. New tags come from
        approving a suggestion.
      </p>
      <table>
        <thead>
          <tr>
            <th>Tag</th>
            <th>Category</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {vocabulary.map((tag) => {
            const retire = tag.status === "active";
            return (
              <tr key={tag.id}>
                <td>
                  {tag.label} <code>{tag.slug}</code>
                </td>
                <td>{tag.category}</td>
                <td>{tag.status}</td>
                <td>
                  <form
                    action={setTagRetiredAction}
                    className="inline"
                    aria-label={`${retire ? "Retire" : "Restore"} “${tag.label}”`}
                  >
                    <input type="hidden" name="tagId" value={tag.id} />
                    <input type="hidden" name="retired" value={retire ? "true" : "false"} />
                    <button type="submit" className="secondary">
                      {retire ? "Retire" : "Restore"}
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
```

In `apps/web/src/app/metrics/layout.tsx`, add `<a href="/metrics/vocabulary">Vocabulary</a>` to the Admin nav.

- [ ] **Step 6: Run the tests.** Run `pnpm check`, then `pnpm --filter web test:e2e`. Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/web
git commit -m "feat(admin): retire and restore vocabulary tags"
```

---

### Task 12: Deploying Phase 4 (with the owner)

This needs the owner's Vercel account, so do it with them. Nothing here buys or connects a domain.

**Files:**

- Modify: `docs/deploy.md`, `docs/superpowers/plans/2026-09-26-roadmap.md`, and `apps/web/src/app/(site)/privacy/page.tsx` (only if the owner shortens the backup wording in Step 3)

- [ ] **Step 1: End-of-phase checks.** Run `pnpm check`, `pnpm knip:production` and `pnpm --filter web test:e2e`. Expected: all pass.
  - The build lists `○ /`, `○ /privacy`, `○ /terms`, `○ /support`, `○ /robots.txt` and `○ /sitemap.xml` (static), and `ƒ /metrics`, `ƒ /metrics/suggestions`, `ƒ /metrics/swings`, `ƒ /metrics/swings/[id]`, `ƒ /metrics/opt-outs` and `ƒ /metrics/vocabulary` (dynamic), plus `ƒ Proxy (Middleware)`.
  - If `knip:production` reports an export used only by tests, make it module-private rather than adding a consumer.
- [ ] **Step 2: Set the environment (owner).** From `apps/web`:
  1. `vercel env add SITE_URL production` → `https://mymeetingapp.vercel.app`, then the same for `preview` (not sensitive).
  2. Generate a password with `openssl rand -base64 30`, and save it in the password manager as "mymeetingapp /metrics (production)".
  3. `vercel env add METRICS_USER production --sensitive` (a user name of your choice), then `vercel env add METRICS_PASSWORD production --sensitive` (the password).
  4. Repeat for `preview` with a different password.
- [ ] **Step 3: Check the backup window (owner decision 3).** In the Neon console, open the project's settings and find the restore (history retention) window. The draft says "up to 30 days".
  - If the window is at most 30 days, keep it.
  - To state the exact window instead, change the Backups paragraph in `apps/web/src/app/(site)/privacy/page.tsx` and the test in `privacy-policy.test.tsx` together.
- [ ] **Step 4: Record the runbook.** Add a "Phase 4: website and metrics" section to `docs/deploy.md` with these subsections:

  **Variables**
  - `SITE_URL`: the canonical origin, `https://mymeetingapp.vercel.app` in Production and Preview. It is baked into static pages, robots.txt and the sitemap at build time, so a change needs a redeploy. A missing or malformed value fails the build.
  - `METRICS_USER` / `METRICS_PASSWORD`: sensitive, different in Production and Preview, kept in the password manager. The password must be at least 16 characters; a shorter one refuses every sign-in.

  **Signing in to /metrics**
  - Open `/metrics`; the browser asks for the user and password.
  - After 20 failed sign-ins in a UTC day, everyone is refused until midnight UTC. To clear it early, run this in the Neon SQL editor on production: `delete from rate_limits where bucket = 'metrics_login';`

  **Weekly review**
  - `/metrics/suggestions`: approve, merge or reject each pending suggestion. Reviewing removes the device link.
  - `/metrics/swings`: open each flag, block the phones behind it if it's spam, then close the flag.
  - Opt-out emails go to `/metrics/opt-outs`. For a feed, also add `opted_out: true` to its entry in `tools/feed-discovery/registry.yaml` in a pull request, so the registry records it.
  - `/metrics/vocabulary`: retire or restore tags.

  **Privacy policy upkeep**
  - The policy renders `apps/web/src/content/privacy-inventory.ts`, and `privacy-policy.test.tsx` checks it against SPEC.md §2 and §13 and the schema.
  - When `SUGGESTION_MODEL` changes, update the suggestion-screening entry in `THIRD_PARTIES`.
  - The policy and terms say "Draft, pending legal review" until the §16 legal review is done.

  **Connecting mymeetingapp.com later** (not done in Phase 4):
  1. Vercel → the project → Settings → Domains: add `mymeetingapp.com`, and add `www.mymeetingapp.com` redirecting to it.
  2. At the registrar, set the DNS records Vercel shows (an A record for the apex and a CNAME for `www`), or point the nameservers at Vercel.
  3. Wait until Vercel shows the domain as valid, with a certificate.
  4. Replace `SITE_URL` for Production (and Preview) with `https://mymeetingapp.com`: `vercel env rm SITE_URL production`, then `vercel env add SITE_URL production`.
  5. Redeploy production, because the static pages, robots.txt and the sitemap carry `SITE_URL` from the build.
  6. Check that `https://mymeetingapp.com/robots.txt` names `https://mymeetingapp.com/sitemap.xml`, and that `/privacy`'s canonical link uses the new domain.
  7. `mymeetingapp.vercel.app` keeps working. Once the new domain is live, you can redirect it from the Vercel domain settings.
  8. The feed User-Agent already names `mymeetingapp.com` (`BRAND.domain`), so nothing changes there. Update the store listings' privacy and support URLs if they were already submitted.

  Also add to "Checking a deployment":
  - `/`, `/privacy`, `/terms` and `/support` return 200 and set no cookie.
  - `/robots.txt` disallows `/metrics` and `/api/`.
  - `/metrics` returns 401 without credentials and 200 with them.

- [ ] **Step 5: Update the roadmap.** In `docs/superpowers/plans/2026-09-26-roadmap.md`:
  - Change Phase 4's "Ends with" cell to "Site live on the Vercel address (canonical URL from `SITE_URL`), `/metrics` usable".
  - In Phase 4's scope, replace "Connect mymeetingapp.com." with "Canonical URL from `SITE_URL`. Connecting mymeetingapp.com waits until the owner is ready (owner decision 2026-09-29); the steps are in docs/deploy.md."
  - Add "Detailed plan: `2026-09-29-phase-4-website-metrics.md`."
  - Commit with `docs(deploy): Phase 4 variables, admin runbook and the future domain steps`.
- [ ] **Step 6: Open the PR and check the preview.** CI must be green, e2e included. On the preview (use `vercel curl`, as in "Checking a deployment"):
  1. `/` returns 200 with the footer disclaimer, and has no `set-cookie` header.
  2. `/robots.txt` names `https://mymeetingapp.vercel.app/sitemap.xml`.
  3. `/metrics` returns 401 with `WWW-Authenticate: Basic realm="mymeetingapp admin"`, `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.
  4. With `-u <preview user>:<preview password>`, `/metrics` returns 200 and shows totals.
  5. In a browser, sign in on the preview. Seed a suggestion by posting `/api/v1/suggestions` with a made-up device, then reject it on `/metrics/suggestions`. The page returns with "Rejected."
- [ ] **Step 7: Merge.** Afterwards, on `https://mymeetingapp.vercel.app`:
  - `/` shows the landing page in light and dark mode (switch the OS appearance).
  - `/metrics` asks for credentials and shows the totals, and any failing feed appears under "Feeds needing attention".
  - The Vercel project has Web Analytics and Speed Insights switched off (Project → Analytics), per §2.

---

## Done when

- `pnpm check`, `pnpm knip:production` and `pnpm --filter web test:e2e` pass, and CI is green.
- The site is live on `https://mymeetingapp.vercel.app` with `SITE_URL` set, and `/metrics` works with the production credentials.
- Spec §14 criteria covered here:
  - **`/metrics` returns 401 without credentials** (Task 6: `proxy.test.ts`, and `metrics-auth.e2e.ts` against the built app).
  - **Shows totals only** (Task 7). `readMetrics` returns only counts, and `metrics.e2e.ts` asserts that no device hash appears. The one per-device view is the swing review for one meeting (Task 9), which §6 allows within 7 days.
  - **Admin actions reject cross-origin requests** (Task 6 `proxy.test.ts`; Task 8 `admin-suggestions.e2e.ts`, where a real action form posted from another origin gets 403 and changes nothing).
  - **A failing feed is shown on `/metrics`** (Task 7: `admin-metrics.test.ts` and `metrics.e2e.ts`; isolation is Phase 2's).
  - **Every privacy policy statement maps to a row in §13 and to behavior in code** (Task 3: `privacy-policy.test.tsx` checks the policy against SPEC.md §13 and §2 and the schema, and the retention periods come from `RETENTION`, which the maintenance cron, counts and swing check enforce).
- Spec §9 covered:
  - Landing page, privacy policy, support page with FAQ and opt-outs, and terms (Tasks 1–4).
  - Footer on every page (Task 1).
  - robots.txt, sitemap, Open Graph and `MobileApplication` data (Tasks 2 and 5).
  - Atkinson Hyperlegible self-hosted, light and dark (Task 1).
  - The iOS Smart App Banner waits for an App Store ID (Phase 6), as do the store links.
- Spec §10 admin views covered:
  - Suggestion review and the AI decision log (Task 8).
  - Flagged swings with their 7-day audit rows, and blocking a device (Task 9).
  - Per-meeting `tags_disabled` and feed `opted_out` (Task 10).
  - Retiring tags, from §5 (Task 11).
- Still open after this phase:
  - The §16 legal review of the policy and terms.
  - Connecting `mymeetingapp.com` (steps in docs/deploy.md).
