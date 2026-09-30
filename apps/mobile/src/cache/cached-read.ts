import type { z } from "zod";

import { Unreachable } from "@/api/client";
import { type CacheKind, isFresh } from "@/cache/freshness";
import { forgetOtherSearches, readCache, writeCache } from "@/cache/store";

export interface CachedRead<S extends z.ZodType> {
  kind: CacheKind;
  key: string;
  schema: S;
  fetch: () => Promise<z.output<S>>;
}

// savedAt is set only for a copy older than its reuse window, shown because the server couldn't be reached; the
// screen must say so with <SavedCopyNote>.
export interface CachedResult<T> {
  data: T;
  savedAt: Date | null;
}

async function savedCopy<S extends z.ZodType>(read: CachedRead<S>) {
  const saved = await readCache(read.key);
  if (saved === null) return null;
  // A copy saved by an older app version may not match today's contract; then it's as good as missing.
  const parsed = read.schema.safeParse(saved.body);
  return parsed.success ? { data: parsed.data, savedAt: saved.savedAt } : null;
}

export async function cachedRead<S extends z.ZodType>(
  read: CachedRead<S>,
): Promise<CachedResult<z.output<S>>> {
  const saved = await savedCopy(read);
  if (saved !== null && isFresh(read.kind, saved.savedAt, new Date()))
    return { data: saved.data, savedAt: null };
  try {
    const data = await read.fetch();
    await writeCache(read.key, data);
    if (read.kind === "search") await forgetOtherSearches(read.key);
    return { data, savedAt: null };
  } catch (error) {
    if (error instanceof Unreachable && saved !== null) return saved;
    throw error;
  }
}
