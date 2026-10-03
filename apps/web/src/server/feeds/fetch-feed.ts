import {
  FEED_TIMEOUT_MS,
  feedProblem,
  feedProblemMessage,
  politeFetch,
  readBodyCapped,
  type HostThrottle,
} from "@mymeetingapp/feed-kit";

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

  // The body is read (capped) even on a refusal: only it tells a site's own restriction from a bot check.
  const text = await readBodyCapped(response);
  if (text === null) return { kind: "error", message: "too large" };
  const problem = feedProblem({
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: text,
  });
  if (problem !== null) return { kind: "error", message: feedProblemMessage(problem) };
  return {
    kind: "ok",
    body: JSON.parse(text),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
}
