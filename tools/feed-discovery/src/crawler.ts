import {
  createHostThrottle,
  FEED_TIMEOUT_MS,
  politeFetch,
  readBodyCapped,
  USER_AGENT,
} from "@mymeetingapp/feed-kit";
import robotsParser from "robots-parser";

const MAX_REDIRECTS = 5;
// RFC 9309 §2.3.1.3: a robots.txt that can't be fetched because of a server or network error means the
// whole site is disallowed until it can be.
const DISALLOW_ALL = "User-agent: *\nDisallow: /";

export type CrawlResult =
  | { kind: "response"; status: number; url: string; contentType: string; body: string }
  | { kind: "blocked_by_robots"; url: string }
  | { kind: "error"; message: string };

type Robots = ReturnType<typeof robotsParser>;

// Where a 3xx response points: null when it isn't a redirect, "bad" when its Location isn't a valid URL.
function redirectTarget(response: Response, from: URL): URL | "bad" | null {
  const location = response.headers.get("location");
  if (response.status < 300 || response.status >= 400 || location === null) return null;
  try {
    return new URL(location, from);
  } catch {
    return "bad";
  }
}

// readBodyCapped, with a body that fails part-way (a dropped connection, a stalled read hitting the
// timeout, bad compression) reported rather than thrown.
async function readBody(
  response: Response,
): Promise<{ kind: "body"; text: string } | { kind: "error"; message: string }> {
  try {
    const text = await readBodyCapped(response);
    return text === null ? { kind: "error", message: "too large" } : { kind: "body", text };
  } catch {
    return { kind: "error", message: "could not read the response" };
  }
}

export type Crawler = ReturnType<typeof createCrawler>;

// Spec §4 politeness: robots.txt for every hop, one request per second per host, an honest
// User-Agent, a timeout, and no retries.
export function createCrawler() {
  const throttle = createHostThrottle();
  const robotsByOrigin = new Map<string, Promise<Robots>>();

  function request(url: URL) {
    return politeFetch(url, throttle, { redirect: "manual", timeoutMs: FEED_TIMEOUT_MS });
  }

  // RFC 9309 §2.3.1: follows up to five redirects (each hop through the throttle); a 2xx is parsed; a
  // 4xx, a bad or endless redirect (robots.txt "unavailable") means no rules at all; and a 5xx or network
  // failure disallows everything.
  async function fetchRobotsText(robotsUrl: URL): Promise<string> {
    let url = robotsUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await request(url);
      if (!(response instanceof Response)) return DISALLOW_ALL;
      const next = redirectTarget(response, url);
      if (next === "bad") return "";
      if (next !== null) {
        await response.body?.cancel();
        url = next;
        continue;
      }
      if (response.status >= 500) return DISALLOW_ALL;
      if (!response.ok) return "";
      // A robots.txt that fails mid-read (or is absurdly large) is treated like a network error.
      const body = await readBody(response);
      return body.kind === "body" ? body.text : DISALLOW_ALL;
    }
    return "";
  }

  function robotsFor(url: URL): Promise<Robots> {
    let robots = robotsByOrigin.get(url.origin);
    if (robots === undefined) {
      const robotsUrl = new URL("/robots.txt", url.origin);
      robots = fetchRobotsText(robotsUrl).then((text) => robotsParser(robotsUrl.toString(), text));
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
        if (!(response instanceof Response)) return response;
        const next = redirectTarget(response, url);
        if (next === "bad") return { kind: "error", message: "bad redirect" };
        if (next !== null) {
          await response.body?.cancel();
          url = next;
          continue;
        }
        const body = await readBody(response);
        if (body.kind === "error") return body;
        return {
          kind: "response",
          status: response.status,
          url: url.toString(),
          contentType: response.headers.get("content-type") ?? "",
          body: body.text,
        };
      }
      return { kind: "error", message: "too many redirects" };
    },
  };
}
