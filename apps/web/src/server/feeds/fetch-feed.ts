import { FEED_TIMEOUT_MS, politeFetch, readBodyCapped, type HostThrottle } from "@mymeetingapp/feed-kit";

export type FeedFetchResult =
  | { kind: "ok"; body: unknown; etag: string | null; lastModified: string | null }
  | { kind: "not_modified" }
  | { kind: "error"; message: string };

export async function fetchFeed(
  url: string,
  cache: { etag: string | null; lastModified: string | null },
  throttle: HostThrottle,
): Promise<FeedFetchResult> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cache.etag !== null) headers["If-None-Match"] = cache.etag;
  if (cache.lastModified !== null) headers["If-Modified-Since"] = cache.lastModified;

  const response = await politeFetch(new URL(url), throttle, { headers, timeoutMs: FEED_TIMEOUT_MS });
  if (!(response instanceof Response)) return response;
  if (response.status === 304) return { kind: "not_modified" };
  if (response.status === 401 || response.status === 403) {
    return { kind: "error", message: `restricted (HTTP ${String(response.status)})` };
  }
  if (!response.ok) return { kind: "error", message: `HTTP ${String(response.status)}` };

  const text = await readBodyCapped(response);
  if (text === null) return { kind: "error", message: "too large" };
  try {
    return {
      kind: "ok",
      body: JSON.parse(text),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
  } catch {
    return { kind: "error", message: "not valid JSON" };
  }
}
