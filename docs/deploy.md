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
   - If it doesn't, previews branch from `main`. That is acceptable only until Phase 3 adds device data, and a CI step that creates preview branches from `seed` through the Neon API is required before Phase 3 ships.

Done on 2026-09-26: `seed` and `main` are migrated and hold the 26 starter tags.

- **First deployment:** the project's first Git deployment went to Production even though it came from `phase-1-foundation`. Vercel promotes the first deployment when no production deployment exists. It ran the Phase 1 migrations on `main`, which merging would have done anyway.
- **Running a command against a Vercel environment:** use `vercel env run -e <environment> -- <command>` from `apps/web`, for example `vercel env run -e production -- pnpm db:seed`. **Move `apps/web/.env.local` aside first**: `vercel env run` lets the local file win, so the command would otherwise hit the local Docker database.
- **Seeding a Neon branch directly:** use `DATABASE_URL="<branch pooled URL>" pnpm db:seed`. Copy the URL from the Neon console and don't save it to a file.
- **After seeding:** run `vercel cache purge --type cdn --yes`, because `/api/v1/vocabulary` is cached for an hour.

`MIN_VERSION_*`, `LATEST_VERSION_*` and `FEATURE_*` are unset on purpose: unset means "never force an upgrade" and "feature on". Add one only when it needs a different value (`vercel env add <NAME> production`).

**Plan:** the team is on Hobby. Phase 2's 15-minute feed-sync cron needs Pro, so upgrade before Phase 2 deploys.

## Checking a deployment

Preview deployments are protected, so use `vercel curl` (or a deployment protection bypass):

- `/api/v1/vocabulary` returns 200 with every starter tag, including `old-timers`, and `cache-control: public, s-maxage=3600, stale-while-revalidate=86400`.
- `/api/v1/config` returns 200 with the configured versions and switches.
- In the Neon console, the preview's branch has the `tags` table and its parent is `seed`.

## Rules

- Previews never use the production branch's data.
- Secrets live only in Vercel environment variables. Never commit `.env*` files; only `.env.example` is tracked.
- Every migration must work with both the previous and the new code (add first, remove later), because it runs before the new code goes live.
