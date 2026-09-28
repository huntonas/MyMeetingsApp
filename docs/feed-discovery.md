# Feed discovery runbook

`tools/feed-discovery` crawls the AA directory, detects each entity's meeting feed, and writes
`tools/feed-discovery/registry.yaml` and `tools/feed-discovery/coverage.md` (spec §4). This runbook
covers running it, reviewing its output, and getting verified feeds into production.

## Running it locally

For one state (or a few, comma-separated):

```bash
pnpm --filter feed-discovery discover --state VT,TN
```

For everything:

```bash
pnpm --filter feed-discovery discover
```

Both write `registry.yaml` and `coverage.md` in `tools/feed-discovery/`, overwriting the previous
run's files. A manual `opted_out: true` on an entry survives a re-run (see below).

If any state's directory page can't be read (an error status, a timeout, or robots.txt blocking it),
the run stops with an error naming that state and writes neither file, so a flaky aa.org page can never
silently drop that state's entities from the registry. Re-run it later.

**This sends real requests to every entity's website** — about 700 sites for a full run — so it must
never run without the owner's go-ahead first. The one exception is `workflow_dispatch` runs the owner
themselves triggers (see "The monthly workflow" below).

### robots.txt

The crawler reads each site's robots.txt once per run, following RFC 9309. A 2xx robots.txt is obeyed.
A 4xx (usually a 404), or a robots.txt that redirects more than five times, means the site has no rules.
A 5xx, a network error or a timeout means the whole site is treated as disallowed, and every probe comes
back blocked. An entity whose note says `blocked by robots.txt` may therefore just have been down when
the run reached it; the next monthly run tries again.

### How long a full run takes

There's no fixed number: most of the time is spent waiting on ~700 third-party sites, one request per
second per host, and slow or unreachable sites (timeouts, DNS failures) cost more than fast ones. Run a
small pilot first (a state or two, as above) to get a feel for how responsive that batch of sites is
before committing to a full run. The GitHub Actions workflow budgets `timeout-minutes: 180` for a full
run; a local run can take just as long.

## The monthly workflow

`.github/workflows/feed-discovery.yml` runs `pnpm --filter feed-discovery discover`, and if
`tools/feed-discovery/registry.yaml` or `coverage.md` changed, opens a pull request titled
`Feed registry refresh YYYY-MM` on a `registry/YYYY-MM` branch, with the "Changes since the last run"
section of `coverage.md` as the PR body.

Two things must be true before it can open that PR:

- **The repo setting "Allow GitHub Actions to create pull requests"** (Settings → Actions → General →
  Workflow permissions) must be turned on. It's off by default; without it, `gh pr create` fails.
- **The first full run needs the owner's go-ahead** (spec §4, good-citizen rules: don't hit ~700
  third-party sites without asking). For that reason the workflow's `schedule` trigger is commented out
  in the YAML — only `workflow_dispatch` is live. The first run happens locally, or by triggering the
  workflow manually (Actions → Feed discovery → Run workflow), never automatically. Once that first
  run's PR has been reviewed and merged, uncomment the `schedule: - cron: "0 9 1 * *"` block so the
  workflow runs on its own every month.

## Reviewing the PR

The PR body is the coverage report's "Changes since the last run" section: feeds that stopped
responding, entities removed from or new to the directory, and meeting-count drops worth a second look. Read that
section, then skim the full `coverage.md` diff for anything else worth a second look (a state's
verified count dropping, a new restricted feed). Merge once it looks right; nothing is seeded
automatically by merging — that's a separate, manual step (below).

## Recording an opt-out

If an entity has asked not to be listed, or its feed shouldn't be used, add `opted_out: true` to its
entry in `tools/feed-discovery/registry.yaml` and commit the change. Every later `discover` run carries
that flag forward automatically, so it survives future re-verification without being re-added by hand,
even if the entity disappears from the aa.org directory for a while.
Seeding (below) sets `feeds.opted_out` for any entry marked this way.

## Seeding production

Seeding reads `registry.yaml` and upserts every verified feed into the `feeds` table (and applies any
`opted_out: true`). From `apps/web`, with `.env.local` moved aside so the command hits the production
database instead of local Docker (see `docs/deploy.md`):

```bash
mv apps/web/.env.local apps/web/.env.local.bak
cd apps/web
vercel env run -e production -- pnpm --filter web db:seed-feeds ../../tools/feed-discovery/registry.yaml
cd -
mv apps/web/.env.local.bak apps/web/.env.local
```

The command prints a count summary, e.g. `Seeded 412 feeds (6 opted out, 31 skipped)`. Do this after
merging a registry refresh PR whose changes you want live.
