# Engineering standards

These rules apply to every change in this repository. Where a rule can be checked by a tool, the tool enforces it, and `pnpm check` runs every tool. The product rules live in `SPEC.md`. Where the two overlap (privacy especially), the spec wins.

## Definition of done

A change is done when all of these pass:

- `pnpm check` runs formatting, lint, typecheck, knip (dead code), the migration drift check (`check:migrations`: `drizzle-kit generate` must find nothing new, so the migrations in `apps/web/drizzle` match `src/db/schema`), and tests, in that order.
- `pnpm knip:production` reports no exports used only by tests. This must pass at the end of every phase, and CI runs it.
- `DATABASE_URL= pnpm --filter web build` succeeds. Nothing may query the database at build time.

`tools/*` and `packages/test-server` set `includeEntryExports: false` in knip.json, because a tool's `main.ts` exports `run()` for its end-to-end test and test-server is test-only.

Every commit on a branch passes `pnpm check`.

## Test-driven development

1. Write one failing test for one behavior.
2. Run it and watch it fail for the expected reason (the feature is missing, not a typo).
3. Write the least code that makes it pass.
4. Run the whole suite. Refactor only while green.

No production code exists without a test that failed first. Pure constants and type-only declarations are the exception. Test the first behavior that depends on them instead.

### Writing tests

- **Name the break.** Before writing a test, name the production change that would make it fail. If only a deliberate decision (a constant's value, a message's wording) would break it, it's a change detector: test the behavior that depends on the decision instead.
- **Literal expectations.** Expected values are hand-written literals, never computed by the code under test.
- **Real dependencies.** Tests run against a real PostGIS database (`docker compose up -d`). Its URL is set once, in `test.env` of `apps/web/vitest.config.ts`, and `test/global-setup.ts` migrates it before each run. The only things faked are the console (`vi.spyOn(console, …)`) and environment variables (`vi.stubEnv`).
- **Location.** Tests live in each package's `test/` folder, named `<subject>.test.ts`. Shared-package tests import only from `../src/index` (the public API). Web tests import app code through `@/` and test helpers from `./` siblings.
- **Database state.** Every database test calls `resetDb()` in `beforeEach` and closes the pool in `afterAll`. When a new table is added, it's added to `resetDb`.
- **Database constraint tests** assert the constraint's name (`rejects.toMatchObject({ cause: { constraint: "…" } })`), so they can't pass on an unrelated error.
- **Route tests** call the exported handler (`GET(new Request(…))`) and validate the body with the shared zod contract.

## No dead code

- Nothing is written before something uses it. A helper, export, parameter, env var or config entry lands in the same change as its first consumer.
- knip fails the build on unused files, exports, types and dependencies.
- No commented-out code and no `TODO` comments. Future work belongs in the plan or roadmap.
- Parameters that exist only so tests can inject something aren't allowed. Tests use the real thing, `vi.stubEnv`, or `resetDb()`.

## One way to do each thing

| Concern                                                                    | The one way                                                                                                                                                                                                                                                                                                                                 | Enforced by                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| API contract (request/response shapes, error codes, messages)              | A zod schema in `packages/shared` for anything the mobile app reads. Internal endpoints (cron) define their response schema next to the server module that produces it (e.g. `SyncSummary`)                                                                                                                                                 | review                                                     |
| JSON responses                                                             | `jsonResponse(schema, data, cachePolicy, status?)` from `@/lib/api/respond`. The data is parsed through its contract, so unknown keys are stripped before sending                                                                                                                                                                           | lint bans `Response.json` and `NextResponse` elsewhere     |
| Error responses                                                            | Throw `new ApiError(code)` from `@/lib/api/respond` inside `withErrors`; it sends that code's envelope and logs nothing. Unexpected errors become `server_error`                                                                                                                                                                            | lint (as above)                                            |
| Request input (bodies, path and query params)                              | `readJsonBody(req, schema)` / `parseInput(schema, value)` from `@/lib/api/request`; a mismatch is `invalid_request`                                                                                                                                                                                                                         | review                                                     |
| Route handlers                                                             | `export const GET = withErrors((_req: Request) => …)`. The handler returns a `Response` or a promise of one; make it `async` only when it awaits. Add `export const dynamic = "force-dynamic"` when it reads the database or environment at request time                                                                                    | review                                                     |
| Cache headers                                                              | a named policy in `CACHE_POLICIES` in `respond.ts`                                                                                                                                                                                                                                                                                          | review                                                     |
| Environment variables                                                      | `readEnv(name)` from `@/env`, in app code and tooling alike. Every variable's name is listed in its `EnvName` type                                                                                                                                                                                                                          | lint bans `process.env` in `apps/web/src` outside `env.ts` |
| Environment files (tooling)                                                | `loadLocalEnvFile()` from `@/env`, called before anything reads the environment. Real environment variables always win over the file                                                                                                                                                                                                        | review                                                     |
| Database access                                                            | the `db` Drizzle client from `@/db/client`, called from `src/db/` (seeding) or `src/server/` (queries for routes). Route files never import `db`                                                                                                                                                                                            | review                                                     |
| Schema changes                                                             | edit `src/db/schema/*.ts`, then `pnpm --filter web db:generate`. Never hand-edit a generated migration. Custom SQL uses `drizzle-kit generate --custom`                                                                                                                                                                                     | review                                                     |
| Columns drizzle-kit can't emit (PostGIS geography)                         | a `drizzle-kit generate --custom` migration, plus an `sql.raw` column reference exported from the schema file (e.g. `meetingLocation`)                                                                                                                                                                                                      | review                                                     |
| Fixed lists of constants in SQL                                            | `sqlStringList(values)` from `@/db/sql` (e.g. CHECK constraints built from `TAG_CATEGORIES`). Never for user input                                                                                                                                                                                                                          | review                                                     |
| Array parameters in raw SQL                                                | `sqlArray(values, type)` from `@/db/sql`, building `array[...]` from individually bound, cast parameters (`sql.param` doesn't bind a JS array as a Postgres array with this driver)                                                                                                                                                         | review                                                     |
| Imports in `apps/web`                                                      | `@/…` for app code; `./` for siblings; never `../`                                                                                                                                                                                                                                                                                          | lint                                                       |
| Logging                                                                    | `logError(context, error)` from `@/lib/log` for failures: database errors log only the SQL text and structured fields, never parameters. `console.warn` for misconfiguration. `console.log` only for command-line output, in `apps/web/scripts/` and each tool's `tools/*/src/main.ts`. Never log requests, headers, bodies or feed content | lint (`no-console`), review                                |
| Polite HTTP for feeds (throttle, User-Agent, timeout, capped body reading) | `politeFetch(url, throttle, { timeoutMs: FEED_TIMEOUT_MS })` and `readBodyCapped` from `@mymeetingapp/feed-kit`                                                                                                                                                                                                                             | review                                                     |
| Authenticated JSON calls to first-party infrastructure APIs at build time  | the `call()` helper in `apps/web/src/db/preview-branch.ts` (bearer auth, zod-validated response, throws on failure). `politeFetch` is GET-only, throttled and never throws, for third-party feeds                                                                                                                                           | review                                                     |
| Mobile write requests (device headers)                                     | `readWriteRequest(req)` then `recordDevice(device, tx)` from `@/server/devices/write-request`. A write that only deletes the device's own data uses `readDeletionRequest(req)` then `lockDevice(deviceHash, tx)` instead (no version check, and it works for a blocked device). The raw device id is hashed there and goes nowhere else     | review                                                     |
| Rate limits                                                                | `consumeDailyLimit(deviceHash, bucket, tx)` from `@/server/devices/rate-limit`, after every other check, inside the write's transaction                                                                                                                                                                                                     | review                                                     |
| A device's tag row on a meeting                                            | `findOwnSubmissions` / `saveOwnSubmission` from `@/server/tags/own-submissions` (they cover merged-away scopes); never compute a submitter id elsewhere                                                                                                                                                                                     | review                                                     |
| Find every row a device wrote, across all meetings and merged-away scopes  | `everySubmitterIdBatch(deviceHash, executor)` from `@/server/tags/own-submissions` (used by delete-mine and blockDevice), batched under Postgres's bind-parameter limit                                                                                                                                                                     | review                                                     |
| AI calls                                                                   | `generateText` from `ai` with a model from `createGateway({ baseURL: readEnv("AI_GATEWAY_BASE_URL") })` and `providerOptions: { gateway: { zeroDataRetention: true } }`; tests point `AI_GATEWAY_BASE_URL` at `@mymeetingapp/test-server`. Log only an AI error's name, never its message                                                   | review                                                     |

When you need a second way, change this table first, in the same change, with a reason.

## Code style

- **Formatting:** Prettier, 110 columns. Don't argue with it.
- **Files:** kebab-case (`seed-vocabulary.ts`). One responsibility per file.
- **Names:**
  - Functions are camelCase verbs (`readAppConfig`).
  - zod schemas are PascalCase, with a type of the same name (`VocabularyResponse`).
  - Module-level constant lists and maps are SCREAMING_CASE (`TAG_CATEGORIES`).
- **Types:** TypeScript strict, with `noUncheckedIndexedAccess`. No `any`, no non-null assertions (`!`), no `as` casts except `as const` and on the results of runtime checks. Tests that pass deliberately invalid input use `// @ts-expect-error -- <why>`, never a cast. Use `import type` for types.
- **Comments:** only to explain _why_ something non-obvious is done. Don't restate the code.
- **Errors:** throw `Error` for programmer mistakes. User-facing failures are `apiError` codes with plain-language messages in `packages/shared/src/errors.ts`.

## Privacy rules for code

These restate `SPEC.md` §2 where it touches code:

- Never log request headers, request bodies, IP addresses or coordinates.
- Raw device IDs never reach the database or logs.
- A response body only ever contains the fields its contract names (`jsonResponse` strips the rest).

## Git

- Branch per phase (`phase-1-foundation`); never commit implementation directly to `main`.
- Conventional commit messages (`feat(api): …`, `chore: …`, `test: …`, `docs: …`).
- Small commits, each passing `pnpm check`.

## Local setup

```bash
nvm use                      # Node 24 (.nvmrc)
corepack enable              # pnpm version from package.json
pnpm install
docker compose up -d         # PostGIS on localhost:5433 (dev: mma_dev, tests: mma_test)
cp apps/web/.env.example apps/web/.env.local
pnpm check
```
