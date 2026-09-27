import { readEnv } from "@/env";

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

// The direct (unpooled) connection, for anything a PgBouncer transaction-mode pooler can't support:
// migrations (drizzle.config.ts) and session-level advisory locks (server/sync/run-sync.ts).
export function directDatabaseUrl(): string | undefined {
  return withVerifiedTls(readEnv("DATABASE_URL_UNPOOLED") ?? readEnv("DATABASE_URL"));
}
