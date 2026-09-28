import type { HostThrottle } from "./throttle";
import { USER_AGENT } from "./user-agent";

// Spec §4 politeness: no single feed or site may hold up a run for longer than this.
export const FEED_TIMEOUT_MS = 30_000;

export interface FetchError {
  kind: "error";
  message: "timed out" | "could not connect";
}

// Spec §3/§4 politeness in one place: waits its turn on the per-host throttle, identifies itself with the
// project User-Agent, gives up after `timeoutMs`, and never retries. Network failures come back as a
// plain-language error rather than a throw.
export async function politeFetch(
  url: URL,
  throttle: HostThrottle,
  options: { headers?: Record<string, string>; redirect?: "follow" | "manual"; timeoutMs: number },
): Promise<Response | FetchError> {
  await throttle.wait(url.host);
  try {
    return await fetch(url, {
      headers: { ...options.headers, "User-Agent": USER_AGENT },
      redirect: options.redirect ?? "follow",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not connect",
    };
  }
}
