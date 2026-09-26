# mymeetingapp

A privacy-first AA meeting finder: Expo mobile app, a Next.js 16 site and API, and Neon Postgres.

- Product spec (source of truth): `SPEC.md`
- Engineering standards (how code is written here): `docs/standards.md`. Read it before changing code.
- Plans: `docs/superpowers/plans/` (roadmap plus one plan per phase)

## Commands

- `pnpm check`: format, lint, typecheck, dead-code check, tests. Must pass before every commit.
- `pnpm knip:production`: fails on exports used only by tests. Must pass at the end of each phase.
- `docker compose up -d`: local PostGIS needed by the web tests.
- Node 24 via `nvm use`; pnpm via corepack.

## Rules that matter most

- Test-driven: a failing test first, always.
- No dead code, and one way to do each thing. The table in `docs/standards.md` lists the one way.
- Never log request headers, bodies, IPs or coordinates.
