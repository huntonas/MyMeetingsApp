# Deploying mymeetingapp (web + API)

Vercel (team `huntonas-projects`; Pro needed from Phase 2) hosts `apps/web`, and Neon provides Postgres. Builds run `pnpm run db:reset-preview && pnpm run db:migrate && pnpm run build` (see `apps/web/vercel.ts`), so each deployment migrates its own database branch before building; preview builds first restore the shared `preview` branch from `seed` (see "Preview databases" below).

## One-time setup

Done with the Vercel CLI (60.x) on 2026-09-26:

- Project `mymeetingapp` in team `huntonas-projects`: root directory `apps/web`, framework Next.js, Node.js 24.x (`vercel project add`, then `vercel api -X PATCH /v9/projects/mymeetingapp`).
- GitHub repository `huntonas/MyMeetingsApp` connected, with `main` as the production branch.
- `apps/web` linked to it (`vercel link --yes --team huntonas-projects --project mymeetingapp`; `.vercel/` is git-ignored).
- Neon provisioned from the Marketplace as `mymeetingapp-db`: region `iad1`, free plan, created with `vercel integration add neon --name mymeetingapp-db --no-env-pull --no-claim`. Since 2026-09-29 it is connected to **Production only** (reconnected with no per-deployment branching, no prefix, Sensitive off so `vercel env run` can read the URLs); Preview has its own variables (see "Preview databases").
  - `--no-env-pull` keeps the production URL out of `apps/web/.env.local`, which must keep pointing at local Docker.
  - The integration also created unused `NEON_AUTH_*` / `VITE_NEON_AUTH_URL` variables. Neon Auth is on by default and can't be changed after creation, and the app never reads them.
- **Restore history:** the privacy policy says deleted data can remain in Neon's restore history for at most 30 days (owner decision 3). Keep the production project's restore window at 30 days or less, and record the configured window here: _not yet recorded_.

Needs the dashboard (no CLI or API for these): see "Preview databases" below.

Done on 2026-09-26: `seed` and `main` are migrated and hold the 26 starter tags.

- **First deployment:** the project's first Git deployment went to Production even though it came from `phase-1-foundation`. Vercel promotes the first deployment when no production deployment exists. It ran the Phase 1 migrations on `main`, which merging would have done anyway.
- **Running a command against a Vercel environment:** use `vercel env run -e <environment> -- <command>` from `apps/web`, for example `vercel env run -e production -- pnpm db:seed`. **Move `apps/web/.env.local` aside first**: `vercel env run` lets the local file win, so the command would otherwise hit the local Docker database.
- **Seeding a Neon branch directly:** use `DATABASE_URL="<branch pooled URL>" pnpm db:seed`. Copy the URL from the Neon console and don't save it to a file.
- **After seeding:** run `vercel cache purge --type cdn --yes`, because `/api/v1/vocabulary` is cached for an hour.

`MIN_VERSION_*`, `LATEST_VERSION_*` and `FEATURE_*` are unset on purpose: unset means "never force an upgrade" and "feature on". Add one only when it needs a different value (`vercel env add <NAME> production`).

**Plan:** the team is on Hobby. Phase 2's 15-minute feed-sync cron needs **Vercel Pro**, so upgrade before Phase 2 deploys. Do not skip this step; the cron will not run on Hobby.

## Preview databases

Previews share one Neon branch, `preview`, whose parent is `seed`. `seed` was created from `main` on 2026-09-29 while `main` held reference data only (vocabulary, feeds, meetings), before any device table existed. Every preview build runs `pnpm run db:reset-preview` first. It restores `preview` from `seed` through the Neon API (`POST /projects/{project}/branches/{preview}/restore` with `source_branch_id` = seed), waits for Neon to finish, and then migrates. Production and local builds skip the reset. The script refuses any branch whose parent isn't named `seed`.

On 2026-10-01 two leftover branches from the old per-deployment preview branching, `preview/phase-3-plan` and `preview/smarter-meeting-matching` (both children of `main`, created 2026-09-28), were deleted after checking no Vercel environment used their endpoints (owner decision). The project now has exactly `main`, `seed`, `preview` and `staging`.

- **Production device data never reaches `seed` or `preview`.** `seed` is never branched from `main` again, never restored from `main`, and never gets device tables except through a preview's own migrations. Refresh `seed`'s reference data only with `DATABASE_URL="<seed pooled URL>" pnpm --filter web db:seed` (and `db:seed-feeds`), never by copying from `main`.
- **Tags on a preview live until the next preview build,** because every build resets `preview`. Two preview builds at once reset each other.
- **The Neon integration's per-deployment preview branching is off,** and the integration sets no Preview variables. Preview uses `DATABASE_URL`, `DATABASE_URL_UNPOOLED` (the `preview` branch's pooled and direct URLs), and sensitive `NEON_API_KEY` (project-scoped), `NEON_PROJECT_ID` and `NEON_PREVIEW_BRANCH_ID`.
- **Setting it up again:**
  1. Create `seed` from `main`, but only while `main` has no device tables; otherwise create an empty branch, migrate it and seed it.
  2. Create `preview` from `seed`, neither with an expiration.
  3. Turn off per-deployment preview branching and untick Preview in the integration's settings.
  4. Add the five Preview variables with `vercel env add <NAME> preview` (`--sensitive` for the three `NEON_*`).
- **Checking it:** the preview build log shows `Restored the preview database branch from seed` before the migration output, and Neon shows `preview`'s latest restore time.

## Checking a deployment

Preview deployments are protected, so use `vercel curl` (or a deployment protection bypass):

- `/api/v1/vocabulary` returns 200 with every starter tag, including `old-timers`, and `cache-control: public, s-maxage=3600, stale-while-revalidate=86400`.
- `/api/v1/config` returns 200 with the configured versions and switches.
- In the Neon console, `preview`'s parent is `seed` and its last restore is the build's time.
- `/`, `/privacy`, `/terms` and `/support` return 200 and set no cookie.
- `/robots.txt` disallows `/metrics` and `/api/`.
- `/metrics` returns 401 without credentials and 200 with them.

Staging (`https://mymeetingapp-staging.vercel.app`) is public, so plain `curl` works — no `vercel curl` bypass needed:

- `/api/v1/config` returns 200 with no Vercel login page.
- `/api/v1/vocabulary` returns the configured tags (26 on 2026-09-30).
- `POST /api/v1/meetings/search` for a point near Maryville, TN returns meetings (158 on 2026-09-30).
- `curl -sI` on `/` shows `x-robots-tag: noindex, nofollow`; the same check against production shows none.
- `/metrics` returns 401 without credentials.
- `/api/cron/sync-feeds` and `/api/cron/maintenance` return 401 without staging's `CRON_SECRET`; only the maintenance workflow holds it, and it never calls sync.
- The deployment's own URL (not the stable `mymeetingapp-staging.vercel.app` domain) still redirects to the Vercel login: only the stable domain carries the Deployment Protection Exception, so a per-deployment preview stays protected.
- In the Neon console, `staging`'s parent is `seed`, and `preview`'s last restore time is unchanged by a staging build.
- `gh workflow run staging-maintenance.yml` succeeds and its log shows the maintenance counts.
- A write with a throwaway device (`X-Device-Id: curl-check-<random>`, `X-Platform: ios`, `X-App-Version: 0.1.0`): `POST /api/v1/tags` naming a meeting that doesn't exist answers `meeting_not_found`, `POST /api/v1/tags/delete-mine` answers `{"deletedTags":0}`, and delete-mine without the headers answers `invalid_request`.
- Checked 2026-10-01 after the redeploy from `main` (92f732f): every check above passed; the first maintenance run reported all counts 0.

## Phase 2: meeting sync

Phase 2 adds a cron job that runs every 15 minutes and syncs the feeds that are due: each feed is fetched at most once a week, and a failing one is retried after a day. This requires **Vercel Pro** (Hobby plan allows only daily crons). Upgrade the team before deploying Phase 2.

### Setting CRON_SECRET

The `/api/cron/sync-feeds` route requires an `Authorization` header with a bearer token. Generate and store it:

1. Generate the secret with `openssl rand -hex 32`.
2. Add it to production with `vercel env add CRON_SECRET production`, paste the value (it will not be echoed).
3. Add it to preview the same way (`vercel env add CRON_SECRET preview`) so you can test the sync on preview deployments.

The secret is never echoed, logged or committed. If `Authorization` is missing or wrong, the route refuses the request with 401.

### Adding a feed

Use the `db:add-feed` CLI:

1. Move `apps/web/.env.local` aside: `mv apps/web/.env.local apps/web/.env.local.bak`. This is necessary because `vercel env run` will otherwise use the local `.env.local` and hit the local Docker database instead of the remote branch.
2. From `apps/web`, run:
   ```bash
   vercel env run -e production -- pnpm db:add-feed \
     --slug <slug> \
     --name "<name>" \
     --entity-type <entity-type> \
     --state <state> \
     --url <url>
   ```
3. Restore the local env: `mv apps/web/.env.local.bak apps/web/.env.local`.

Running it again with an existing slug updates that feed. A changed URL or priority makes the feed due at once and fetched in full on the next sync (no cached `ETag`), which also re-picks each meeting's primary source. A feed that opted out and later opts back in is also fetched in full.

### Triggering a sync by hand

`CRON_SECRET` is stored as a sensitive variable, so its value can't be read back with the CLI (`vercel env run`/`pull` leave it empty). To run the sync immediately (e.g. after adding a feed), open the Vercel dashboard → the project → **Settings → Cron Jobs** and click **Run** next to `/api/cron/sync-feeds`. Vercel sends the secret itself. Otherwise, wait for the next 15-minute run.

The response is a count summary only (`SyncSummary`), for example:

```json
{ "status": "done", "synced": 1, "unchanged": 0, "failed": 0, "geocoded": 3 }
```

`status` is `"locked"`, with every count 0, when another sync run is still going.

### Direct database connection for the sync lock

The sync holds a session-level advisory lock so only one run happens at a time. That needs a real database session, which Neon's PgBouncer pooler (transaction mode) can't give. `DATABASE_URL_UNPOOLED` must therefore be the direct host (without `-pooler` in the hostname). The Neon integration provides it; confirm its host has no `-pooler` in every environment. If it is unset, the sync falls back to `DATABASE_URL`, which in production is the pooled host and would break the lock.

### TLS configuration

Connection strings are upgraded to `sslmode=verify-full` in the application code, so the Neon integration's environment variables remain unchanged. No extra setup is needed.

### Shrink guard

If a feed previously had 20 or more listings (one per meeting per day) and suddenly returns fewer than half as many, the sync will reject the update and set `feeds.last_error` to `"meeting count dropped from X to Y; not applied"`. This prevents accidental deletion of meetings.

If the drop is legitimate (e.g., the data source changed), reset the stored count in the Neon console:

```sql
update feeds set meeting_count = null, last_attempt_at = null where slug = '<slug>';
```

The next sync will apply the new count.

### Mailbox for feed requests

The feed sync includes `admin@goodersoftwarellc.com` in the User-Agent header of every HTTP request to feed sources. This mailbox must exist and be monitored, as feed maintainers may contact it with questions about the app.

## Phase 3: tagging

### Variables

- `DEVICE_ID_PEPPER`: sensitive, different in every environment (generate each with `openssl rand -hex 32`). The production and preview values live in `apps/web/.env.secrets` (see "Local secrets file"), because Vercel won't show a sensitive value again. It can never be rotated: every device hash and submitter id derives from it, and `db:block-device` needs it.
- `REQUIRE_ATTESTATION=off` in Production and Preview until Phase 6. Any other value refuses every write, because no platform verifier exists yet.
- `SUGGESTION_MODEL`: a model the AI Gateway lists with `zdr: "all"`, currently `openai/gpt-5-nano` (owner decision 2026-09-29: the gateway's free tier doesn't include `anthropic/claude-haiku-4.5`; switching back needs paid gateway credits and only this variable). Check a model with `curl -fsSL https://ai-gateway.vercel.sh/v1/models | jq '.data[] | select(.id=="openai/gpt-5-nano") | .zdr'`. The AI Gateway needs a card on the Vercel team. Without the variable, suggestions stay pending and each request logs a warning. The privacy policy names the current model (`THIRD_PARTIES` in `apps/web/src/content/privacy-inventory.ts`), so changing `SUGGESTION_MODEL` means updating that entry in the same change.
- The AI Gateway authenticates with Vercel OIDC; no API key is set on Vercel.

### Maintenance cron

`/api/cron/maintenance` runs nightly at 08:07 UTC (off the quarter hour, so it never starts alongside a feed sync): it purges `tag_audit` rows older than 7 days, `rate_limits` rows older than yesterday (UTC), suggestion device links older than 30 days and devices inactive for 13 months (blocked devices are kept), then recounts every meeting's tags. Run it by hand from Settings → Cron Jobs → Run. The response is counts only.

### Blocking a device

Normally, block from `/metrics/swings`: open the flag, then choose Block next to each phone behind it. The CLI below does the same thing and stays for when the site is down.

Find the device's hash in `tag_audit` for the flagged meeting (Neon SQL editor on production; rows last 7 days). Move `apps/web/.env.local` aside, then from `apps/web`:

```bash
vercel env run -e production -- sh -c 'DEVICE_ID_PEPPER="$0" pnpm db:block-device --device-hash <hash>' \
  "$(sed -n 's/^DEVICE_ID_PEPPER_PRODUCTION=//p' .env.secrets)"
```

`vercel env run` supplies the production `DATABASE_URL` but can't read the sensitive pepper, so it comes from `.env.secrets`. Restore `.env.local` afterwards. Blocking excludes the device's tags on every meeting and refuses its future writes; the `devices` row is kept, even through delete-mine and the 13-month purge.

If the page answers that a block stopped part-way, choose Block again. If the phone already shows as blocked there, its tags were excluded but the last step (rewriting the `devices` row so it shares no transaction id with the excluded rows) didn't run: finish it with the CLI above, using the full hash from `tag_audit` whose first 12 characters the page shows. Running a block again is safe; it repeats every step.

### Local secrets file

`apps/web/.env.secrets` (git-ignored, mode 600, never loaded automatically) holds the values Vercel stores as sensitive and can't show again: `DEVICE_ID_PEPPER_PRODUCTION`, `DEVICE_ID_PEPPER_PREVIEW` and `NEON_API_KEY`. It is the only readable copy of the production pepper, so keep an encrypted backup. Losing it doesn't stop production, but nothing could then block a device, and a deleted Vercel variable couldn't be restored. Local development uses its own pepper in `.env.local`.

Phase 4 adds four more sensitive values to the same file, the same way: `METRICS_USER_PRODUCTION`, `METRICS_PASSWORD_PRODUCTION`, `METRICS_USER_PREVIEW` and `METRICS_PASSWORD_PREVIEW` (see "Phase 4: website and metrics" below). Losing these doesn't stop production either, but nobody could sign in to `/metrics` until they're reset with `vercel env rm` / `vercel env add` and a new password saved in both places.

Staging (see "Staging (TestFlight backend)" below) adds four more values, generated and appended the same way: `DEVICE_ID_PEPPER_STAGING`, `METRICS_USER_STAGING`, `METRICS_PASSWORD_STAGING` and `CRON_SECRET_STAGING`. None of them is Sensitive on Vercel — a custom environment can't have Sensitive variables at all — so `vercel env pull` could read them back too, but the readable copy stays here as well, for the same block-a-device and sign-in commands used elsewhere in this file.

### Privacy

Device-derived tables (`devices`, `tag_submissions`, `tag_counts`, `tag_audit`, `rate_limits`, `suggestions`, `ai_decisions`, `tag_swings`, `meeting_aliases`) hold production data only on `main`. **Production device data never reaches `seed` or `preview`:** `seed` is never refreshed from `main`, and `preview` is restored from `seed` on every preview build.

## Phase 4: website and metrics

### Variables

- `SITE_URL`: the canonical origin, already set to `https://mymeetingapp.vercel.app` in Production and Preview (not sensitive). It is baked into static pages, `robots.txt` and the sitemap at build time (`src/lib/site-url.ts`), so a change needs a redeploy. A missing or malformed value fails the build.
- `METRICS_USER` / `METRICS_PASSWORD`: sensitive, different in Production and Preview. The password must be at least 16 characters (`MIN_PASSWORD_LENGTH` in `src/lib/admin-auth.ts`); a shorter one, or either variable being unset, refuses every sign-in. Generate the password with `openssl rand -base64 30` and save it in the password manager, then set both with `vercel env add METRICS_USER production --sensitive` and `vercel env add METRICS_PASSWORD production --sensitive` (repeat for `preview` with a different password). Like the peppers, the readable copies also go in `apps/web/.env.secrets` (see "Local secrets file" above), because Vercel won't show a sensitive value again.

### Signing in to /metrics

- Open `/metrics`; the browser asks for the user name and password.
- **Owner step: a Vercel Firewall rate-limit rule.** In the dashboard → the project → Firewall → Rules, add a custom rule: the path starts with `/metrics`, rate-limited by IP address, a 60-second window, about 30 requests, action Deny (429). This is the per-visitor limit; the app itself stores no IP address for a sign-in attempt (spec §2). **Status (2026-09-29): not yet created — the owner deferred it.** Until it exists, only the site-wide backstop applies; if a burst locks the owner out, clear it with the SQL below.
- Backstop: the app also keeps one site-wide count of failed sign-ins, in Postgres, with no IP, device or user name attached. After 200 failed sign-ins in a UTC day, everyone is refused (429) until midnight UTC, even with the right credentials. A test burst against a preview or production counts toward this same total. Clear it in the Neon SQL editor:
  ```sql
  delete from rate_limits where bucket = 'metrics_login';
  ```

### Weekly review

- `/metrics`: an overview of phone, tagging and feed totals, and any feed needing attention.
- `/metrics/suggestions`: approve, merge or reject each pending suggestion. Reviewing removes the device link.
- `/metrics/swings`: open each flag, block the phones behind it if it's spam, then close the flag. If the page answers that a block stopped part-way (`block_unfinished`), choose Block again; it's safe to repeat, and the CLI fallback for when the site is down is in "Blocking a device" above.
- Opt-out emails go to `/metrics/opt-outs`. For a feed, also add `opted_out: true` to its entry in `tools/feed-discovery/registry.yaml` in a pull request, so the registry records it.
- `/metrics/vocabulary`: retire or restore tags.

### Privacy policy upkeep

- The policy renders `apps/web/src/content/privacy-inventory.ts`, and `privacy-policy.test.tsx` checks it against SPEC.md §2 and §13 and the schema.
- When `SUGGESTION_MODEL` changes, update the suggestion-screening entry in `THIRD_PARTIES`.
- The policy and terms say "Draft, pending legal review" until the §16 legal review is done.
- **Neon restore history:** the policy says deleted data can remain in the database provider's restore history for up to 30 days (owner decision 3). Keep the production project's restore window at 30 days or less. Configured window: _not yet recorded_ (see "Restore history" under "One-time setup" above; the owner records the actual value there once checked in the Neon console). If the owner shortens the wording to an exact window, change the Backups paragraph in `apps/web/src/app/(site)/privacy/page.tsx` and the matching test in `privacy-policy.test.tsx` together.
- **Support email, every quarter:** the policy says we delete support email within 90 days after it's resolved, and that deleted mail can remain in Google's trash and recovery for up to about 55 days after that. Each quarter, never more than 90 days after the last pass, delete every resolved support thread in the Google Workspace mailbox for `admin@goodersoftwarellc.com`, then empty Trash. (Deleting only threads resolved more than 90 days ago, once a quarter, would let a thread wait up to about 180 days.) Never copy an email address or message anywhere else, or link it to a device or tags.

### Connecting mymeetingapp.com later (not done in Phase 4)

1. Vercel → the project → Settings → Domains: add `mymeetingapp.com`, and add `www.mymeetingapp.com` redirecting to it.
2. At the registrar, set the DNS records Vercel shows (an A record for the apex and a CNAME for `www`), or point the nameservers at Vercel.
3. Wait until Vercel shows the domain as valid, with a certificate.
4. Replace `SITE_URL` for Production (and Preview) with `https://mymeetingapp.com`: `vercel env rm SITE_URL production`, then `vercel env add SITE_URL production`.
5. Redeploy production, because the static pages, `robots.txt` and the sitemap carry `SITE_URL` from the build.
6. Check that `https://mymeetingapp.com/robots.txt` names `https://mymeetingapp.com/sitemap.xml`, and that `/privacy`'s canonical link uses the new domain.
7. `mymeetingapp.vercel.app` keeps working. Once the new domain is live, you can redirect it from the Vercel domain settings.
8. The feed User-Agent already names `mymeetingapp.com` (`BRAND.domain`), so nothing changes there. Update the store listings' privacy and support URLs if they were already submitted.

This step is deliberately out of Phase 4 (owner decision 2026-09-29: no domain yet); Phase 4 ends with the site live on the Vercel address.

## Staging (TestFlight backend)

A long-lived backend for the TestFlight build to talk to, separate from Preview and Production. Full detail: `docs/superpowers/plans/2026-09-30-staging-and-testflight.md`.

- **What it is:** the custom environment `staging` (id `env_GC64iVZ67Rup9wnQ4VvS2alNbBuM`), at `https://mymeetingapp-staging.vercel.app`. Vercel still reports `VERCEL_ENV=preview` for it, but `VERCEL_TARGET_ENV=staging` tells it apart from an actual preview. It's public through a Deployment Protection Exception (Owner, dashboard only), and it stays out of search indexes because `proxy.ts` sends `X-Robots-Tag: noindex, nofollow` on it (Vercel drops its own preview `noindex` once a custom domain is attached).
- **How to deploy:** push the commit to the `staging` branch (normally `git push origin main:staging`), pushing only commits whose migrations are final — a branch whose migrations are later regenerated would leave staging's database out of step. The build recognizes `VERCEL_TARGET_ENV=staging`, so `resetPreviewBranch()` skips the preview restore, migrates staging's own Neon branch, and then builds.
- **Database:** the Neon branch `staging` (id `br-weathered-shape-b7p1mjvl`), whose parent is `seed`. It started from the 2026-09-29 meetings snapshot (73,511 active meetings from 233 feeds) with the device tables created empty by migration; testers' own device data accumulates there afterward. It is never restored from `main`, `seed` or `preview`, and production data never reaches it. A periodic refresh from `main` is owner decision 1 and isn't built.
- **Crons:** feed sync never runs on staging. Nightly maintenance runs from `.github/workflows/staging-maintenance.yml` at 08:37 UTC (GitHub Actions, using the repo secret `STAGING_CRON_SECRET`, which equals staging's `CRON_SECRET`), and can be run by hand with `gh workflow run staging-maintenance.yml`. Vercel only runs crons against a project's production deployment, so this replaces them. Never call `/api/cron/sync-feeds` on staging with that secret: it would crawl every feed a second time.
- **Variables:** `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `DEVICE_ID_PEPPER`, `METRICS_USER=owner`, `METRICS_PASSWORD`, `SITE_URL=https://mymeetingapp-staging.vercel.app`, `REQUIRE_ATTESTATION=off`, `SUGGESTION_MODEL=openai/gpt-5-nano` and `CRON_SECRET` (for the maintenance workflow only). None of them can be Sensitive — Vercel only allows that on Production and Preview — and none is imported from Preview. There is no `NEON_*` variable on staging.
- **Setting it up again:** create the custom environment, attach the stable domain, create the Neon branch and its database variables, then the remaining variables, then the Owner's Deployment Protection Exception — `2026-09-30-staging-and-testflight.md` Task 3 Steps 2–6, in that order.

## Phase 6: app checks and the App Store

### The Apple account

Team `PVCZBLDJ73`, being converted from individual to Gooder Software LLC (owner decision 1, 2026-10-02). App Store Connect app `6817873804`, named "My Meeting App: Meeting Finder" (claimed 2026-10-02), bundle ID `com.goodersoftware.mymeetingapp`. EAS submits with the App Store Connect API key `ZG2Z6A5JY3`.

Conversion checks (Task 1 Step 2): _not yet recorded_.

### Variables

| Variable                                         | Local (`.env.local`)                         | Preview | Staging                                   | Production                       |
| ------------------------------------------------ | -------------------------------------------- | ------- | ----------------------------------------- | -------------------------------- |
| `REQUIRE_ATTESTATION`                            | off                                          | off     | on (from TestFlight build 12, 2026-10-03) | off until Task 15                |
| `APPLE_TEAM_ID` / `APPLE_BUNDLE_ID`              | PVCZBLDJ73 / com.goodersoftware.mymeetingapp | unset   | set                                       | set                              |
| `APP_ATTEST_ENVIRONMENT`                         | development                                  | unset   | production                                | production                       |
| `DEVICECHECK_KEY_ID` / `DEVICECHECK_PRIVATE_KEY` | unset                                        | unset   | unset: DeviceCheck refused                | set, the key Sensitive (Task 15) |

TestFlight and App Store builds always attest in Apple's production environment. A dev build on a device attests in development, so it works only against local web. A simulator can't attest at all: point it at local web for anything that writes.

### Staging roll-out (2026-10-03)

- PR #20 merged; production and staging deployed with the attestation migrations, checks off.
- Staging checks with a throwaway device: a challenge of 43 characters; no device headers → `invalid_request`; a made-up registration → `attestation_failed`; delete-mine → `{"deletedTags":0}`.
- TestFlight builds 10 and 11 failed: the App Store provisioning profile predated App Attest. The owner turned App Attest on for the identifier and ran one interactive build, which regenerated the profile; build 12 succeeded.
- Build 12 on the owner's iPhone registered a real App Attest key against staging (Apple's attestation verified against the pinned root).
- Checks switched on in staging (redeploy). Without a proof, and with a DeviceCheck token (staging has no DeviceCheck key), delete-mine answers `attestation_failed`. On the iPhone, tag, edit, remove, Delete all and tag again all succeeded; staging's `device_days` counter reached 2.

## Rules

- Previews never use the production branch's data: they restore from `seed`, which holds no device data (see Preview databases).
- Secrets live only in Vercel environment variables. Never commit `.env*` files; only `.env.example` is tracked.
- Every migration must work with both the previous and the new code (add first, remove later), because it runs before the new code goes live.
