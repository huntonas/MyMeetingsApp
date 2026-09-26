# Deploying mymeetingapp (web + API)

Vercel (Pro team) hosts `apps/web`, and Neon provides Postgres. Builds run `pnpm run db:migrate && pnpm run build` (see `apps/web/vercel.ts`), so each deployment migrates its own database branch before building.

## One-time setup

1. Push the repository to a private GitHub repository.
2. In Vercel, import the repository into the Pro team.
   - **Root Directory:** `apps/web`
   - **Node.js version:** 24
3. In the project's **Storage** tab, add **Neon** from the Vercel Marketplace and connect it to Production and Preview. Confirm the project now has:
   - `DATABASE_URL`: pooled (host contains `-pooler`)
   - `DATABASE_URL_UNPOOLED`: direct
4. Turn on Neon **preview branching**, so each preview deployment gets its own database branch.
5. In Neon, create a branch named `seed` from `main`. It holds reference data only (vocabulary now; feeds and meetings from Phase 2), never device-derived tables.
   - Set `seed` as the parent for preview branches in the integration settings.
   - If the integration can't choose a parent branch, record that here. Previews then branch from `main`, which is acceptable only until Phase 3 adds device data. A CI step that creates preview branches from `seed` through the Neon API is then required before Phase 3 ships.
6. Add these variables for Production and Preview (values as in `apps/web/.env.example`):
   - `MIN_VERSION_IOS`, `MIN_VERSION_ANDROID`
   - `LATEST_VERSION_IOS`, `LATEST_VERSION_ANDROID`
   - `FEATURE_TAGGING`, `FEATURE_SUGGESTIONS`
7. Deploy once, so the migrations create the tables on `main`. Then seed the vocabulary on `main` and on `seed`:
   ```bash
   cd apps/web
   DATABASE_URL="<main branch pooled URL>" pnpm db:seed
   DATABASE_URL="<seed branch pooled URL>" pnpm db:seed
   ```
   Copy the URLs from the Neon console. Don't save them to a file.

## Checking a deployment

Preview deployments are protected, so use `vercel curl` (or a deployment protection bypass):

- `/api/v1/vocabulary` returns 200 with every starter tag, including `old-timers`, and `cache-control: public, s-maxage=3600, stale-while-revalidate=86400`.
- `/api/v1/config` returns 200 with the configured versions and switches.
- In the Neon console, the preview's branch has the `tags` table and its parent is `seed`.

## Rules

- Previews never use the production branch's data.
- Secrets live only in Vercel environment variables. Never commit `.env*` files; only `.env.example` is tracked.
- Every migration must work with both the previous and the new code (add first, remove later), because it runs before the new code goes live.
