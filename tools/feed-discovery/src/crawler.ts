import { createHostThrottle, readBodyCapped, USER_AGENT } from "@mymeetingapp/feed-kit";
import robotsParser from "robots-parser";

const TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

export type CrawlResult =
  | { kind: "response"; status: number; url: string; contentType: string; body: string }
  | { kind: "blocked_by_robots"; url: string }
  | { kind: "error"; message: string };

type Robots = ReturnType<typeof robotsParser>;

export type Crawler = ReturnType<typeof createCrawler>;

// Spec §4 politeness: robots.txt for every hop, one request per second per host, an honest
// User-Agent, a timeout, and no retries.
export function createCrawler() {
  const throttle = createHostThrottle();
  const robotsByOrigin = new Map<string, Promise<Robots>>();

  async function request(url: URL): Promise<Response | { error: string }> {
    await throttle.wait(url.host);
    try {
      return await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return {
        error: error instanceof Error && error.name === "TimeoutError" ? "timed out" : "could not connect",
      };
    }
  }

  function robotsFor(url: URL): Promise<Robots> {
    const robotsUrl = new URL("/robots.txt", url.origin);
    let robots = robotsByOrigin.get(url.origin);
    if (robots === undefined) {
      robots = (async () => {
        const response = await request(robotsUrl);
        const text =
          response instanceof Response && response.ok ? ((await readBodyCapped(response)) ?? "") : "";
        return robotsParser(robotsUrl.toString(), text);
      })();
      robotsByOrigin.set(url.origin, robots);
    }
    return robots;
  }

  return {
    async get(startUrl: string): Promise<CrawlResult> {
      let url = new URL(startUrl);
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        if ((await robotsFor(url)).isDisallowed(url.toString(), USER_AGENT) === true) {
          return { kind: "blocked_by_robots", url: url.toString() };
        }
        const response = await request(url);
        if (!(response instanceof Response)) return { kind: "error", message: response.error };
        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location !== null) {
          url = new URL(location, url);
          continue;
        }
        const body = await readBodyCapped(response);
        if (body === null) return { kind: "error", message: "too large" };
        return {
          kind: "response",
          status: response.status,
          url: url.toString(),
          contentType: response.headers.get("content-type") ?? "",
          body,
        };
      }
      return { kind: "error", message: "too many redirects" };
    },
  };
}
