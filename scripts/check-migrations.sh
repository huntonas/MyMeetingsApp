#!/usr/bin/env bash
# Fails when apps/web/src/db/schema has a change no migration captures. It compares the migrations folder
# before and after drizzle-kit generate rather than against git, so new migrations pass before they're
# committed. cksum, sort -z and xargs -0 behave the same on Linux (CI) and macOS.
set -euo pipefail

dir=apps/web/drizzle
snapshot() { find "$dir" -type f -print0 | LC_ALL=C sort -z | xargs -0 cksum; }

before=$(snapshot)
pnpm --filter web db:generate
after=$(snapshot)

if [ "$before" != "$after" ]; then
  echo "src/db/schema changed without a migration. drizzle-kit just generated one; review and commit it:" >&2
  diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") >&2 || true
  exit 1
fi
