import type { ErrorCode } from "@mymeetingapp/shared";
import type { z } from "zod";

import { ApiError, Unreachable } from "@/api/client";
import { type CacheKind, isFresh } from "@/cache/freshness";
import { readCache, readLastSearch, writeCache, writeSearchResult } from "@/cache/store";

export interface CachedRead<S extends z.ZodType> {
  kind: CacheKind;
  key: string;
  schema: S;
  fetch: () => Promise<z.output<S>>;
}

// Why a stale saved copy is being shown instead of a fresh answer; <SavedCopyNote> reads this to pick its wording.
export type FallbackReason = "unreachable" | "serverError";

// savedAt (and reason) are set only for a copy older than its reuse window, shown because the server couldn't help;
// the screen must say so with <SavedCopyNote>.
export type CachedResult<T> = { data: T; savedAt: null } | { data: T; savedAt: Date; reason: FallbackReason };

// Codes meaning "the server itself is having trouble, try later": showing the saved copy instead of an error screen
// is the better choice. Every other code says something about this specific request (a bad id, an app too old to
// trust); showing an old answer for one of those would be misleading, so those still throw (owner ruling M2,
// 2026-09-29).
const FALLBACK_CODES: readonly ErrorCode[] = ["server_error", "rate_limited"];

function fallbackReason(error: unknown): FallbackReason | null {
  if (error instanceof Unreachable) return "unreachable";
  if (error instanceof ApiError && FALLBACK_CODES.includes(error.code)) return "serverError";
  return null;
}

// The copy saved for `read`, however old, or null. Never throws.
export function savedCopy<S extends z.ZodType>(read: CachedRead<S>) {
  return parsedCopy(read, readCache(read.key));
}

async function parsedCopy<S extends z.ZodType>(
  read: CachedRead<S>,
  reading: Promise<{ body: unknown; savedAt: Date } | null>,
) {
  // The cache is best effort: a broken saved copy (a corrupt row, unreadable JSON, a native storage error) is as
  // good as none, so the read still asks the server instead of failing outright.
  const saved = await reading.catch(() => null);
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
  // Captured before the request, not after it answers: a slow request shouldn't make its copy look newer than it is.
  const fetchedAt = new Date();
  try {
    const data = await read.fetch();
    // Saving is also best effort: a write failure never throws away data that was already fetched successfully.
    const save =
      read.kind === "search"
        ? writeSearchResult(read.key, data, fetchedAt)
        : writeCache(read.key, data, fetchedAt);
    await save.catch(() => undefined);
    return { data, savedAt: null };
  } catch (error) {
    const reason = fallbackReason(error);
    // Spec §8 keeps only the last search offline, so offline a search anywhere new has no copy of its own: the last
    // search is better than nothing, and its data says where it was made (the screen must describe it by that).
    const fallback =
      saved ??
      (reason === "unreachable" && read.kind === "search" ? await parsedCopy(read, readLastSearch()) : null);
    if (reason !== null && fallback !== null)
      return { data: fallback.data, savedAt: fallback.savedAt, reason };
    throw error;
  }
}
