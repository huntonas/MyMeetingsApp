# Deploying mymeetingapp (web + API)

Vercel (team `huntonas-projects`; Pro needed from Phase 2) hosts `apps/web`, and Neon provides Postgres. Builds run `pnpm run db:migrate && pnpm run build` (see `apps/web/vercel.ts`), so each deployment migrates its own database branch before building.

## One-time setup

Done with the Vercel CLI (60.x) on 2026-09-26:

- Project `mymeetingapp` in team `huntonas-projects`: root directory `apps/web`, framework Next.js, Node.js 24.x (`vercel project add`, then `vercel api -X PATCH /v9/projects/mymeetingapp`).
- GitHub repository `huntonas/MyMeetingsApp` connected, with `main` as the production branch.
- `apps/web` linked to it (`vercel link --yes --team huntonas-projects --project mymeetingapp`; `.vercel/` is git-ignored).
- Neon provisioned from the Marketplace as `mymeetingapp-db`: region `iad1`, free plan, connected to Production, Preview and Development. Command: `vercel integration add neon --name mymeetingapp-db --no-env-pull --no-claim`.
  - `--no-env-pull` keeps the production URL out of `apps/web/.env.local`, which must keep pointing at local Docker.
  - The integration also created unused `NEON_AUTH_*` / `VITE_NEON_AUTH_URL` variables. Neon Auth is on by default and can't be changed after creation, and the app never reads them.

Needs the dashboard (no CLI or API for these):

1. **Preview branching** (done 2026-09-26): this is only offered when a project is connected. On an existing connection, **Connect Project** fails with "already connected to the target store", so the fix is to disconnect (`vercel ir disconnect mymeetingapp-db mymeetingapp --yes`, which leaves the live deployments running) and then reconnect in Storage → `mymeetingapp-db` → Connect Project, with these settings:
   - **Environments:** all.
   - **Create Database Branch For Deployment:** Preview on, Production off.
   - **Custom Environment Variable Prefix:** empty.
   - **Sensitive:** off, because sensitive values can't be read back by `vercel env run`. Revisit before launch.
2. **`seed` branch:** in the Neon console (open it from the Storage page), create a branch named `seed` from `main`. It holds reference data only (vocabulary now; feeds and meetings from Phase 2), never device-derived tables. Set `seed` as the parent for preview branches if the integration allows it.
   - Confirmed 2026-09-26: the integration has no parent setting, so previews branch from `main` (e.g. `preview/phase-1-foundation`, created by Vercel). Make sure `seed` has no expiration date in Neon.
   - Because previews branch from `main`, that is acceptable only until Phase 3 adds device data, and a CI step that creates preview branches from `seed` through the Neon API is required before Phase 3 ships.

Done on 2026-09-26: `seed` and `main` are migrated and hold the 26 starter tags.

- **First deployment:** the project's first Git deployment went to Production even though it came from `phase-1-foundation`. Vercel promotes the first deployment when no production deployment exists. It ran the Phase 1 migrations on `main`, which merging would have done anyway.
- **Running a command against a Vercel environment:** use `vercel env run -e <environment> -- <command>` from `apps/web`, for example `vercel env run -e production -- pnpm db:seed`. **Move `apps/web/.env.local` aside first**: `vercel env run` lets the local file win, so the command would otherwise hit the local Docker database.
- **Seeding a Neon branch directly:** use `DATABASE_URL="<branch pooled URL>" pnpm db:seed`. Copy the URL from the Neon console and don't save it to a file.
- **After seeding:** run `vercel cache purge --type cdn --yes`, because `/api/v1/vocabulary` is cached for an hour.

`MIN_VERSION_*`, `LATEST_VERSION_*` and `FEATURE_*` are unset on purpose: unset means "never force an upgrade" and "feature on". Add one only when it needs a different value (`vercel env add <NAME> production`).

**Plan:** the team is on Hobby. Phase 2's 15-minute feed-sync cron needs **Vercel Pro**, so upgrade before Phase 2 deploys. Do not skip this step; the cron will not run on Hobby.

## Checking a deployment

Preview deployments are protected, so use `vercel curl` (or a deployment protection bypass):

- `/api/v1/vocabulary` returns 200 with every starter tag, including `old-timers`, and `cache-control: public, s-maxage=3600, stale-while-revalidate=86400`.
- `/api/v1/config` returns 200 with the configured versions and switches.
- In the Neon console, the preview's branch has the `tags` table and its parent is `seed`.

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

## Rules

- Previews never use the production branch's data.
- Secrets live only in Vercel environment variables. Never commit `.env*` files; only `.env.example` is tracked.
- Every migration must work with both the previous and the new code (add first, remove later), because it runs before the new code goes live.
