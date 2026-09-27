import { readBodyCapped, USER_AGENT, type HostThrottle } from "@mymeetingapp/feed-kit";

const TIMEOUT_MS = 30_000;

export type FeedFetchResult =
  | { kind: "ok"; body: unknown; etag: string | null; lastModified: string | null }
  | { kind: "not_modified" }
  | { kind: "error"; message: string };

export async function fetchFeed(
  url: string,
  cache: { etag: string | null; lastModified: string | null },
  throttle: HostThrottle,
): Promise<FeedFetchResult> {
  const target = new URL(url);
  await throttle.wait(target.host);
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/json" };
  if (cache.etag !== null) headers["If-None-Match"] = cache.etag;
  if (cache.lastModified !== null) headers["If-Modified-Since"] = cache.lastModified;

  let response: Response;
  try {
    response = await fetch(target, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not connect",
    };
  }
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
