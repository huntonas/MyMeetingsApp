import { feedProblem, feedProblemMessage } from "@mymeetingapp/feed-kit";
import { parse } from "node-html-parser";

import type { Crawler, CrawlResult } from "./crawler";
import { classifyFeedType, sheetStorageUrl } from "./sheets";

export type Detection =
  | {
      feedType: "tsml" | "meeting_guide_json" | "google_sheet";
      feedUrl: string;
      body: unknown;
      notes: string;
    }
  | { feedType: "restricted"; feedUrl: string | null; notes: string }
  | { feedType: "bot_blocked"; feedUrl: null; notes: string }
  | { feedType: "none_found"; notes: string };

const TSML_RESTRICTED_NOTE = "TSML feed restricted; contact the intergroup";

// A 2xx response whose body parses as a JSON array is a feed; anything else (error status, non-JSON,
// or JSON that isn't an array) is not a definite feed, so callers fall through to the next probe in
// the spec's order.
function jsonArray(result: CrawlResult): unknown[] | null {
  if (result.kind !== "response" || result.status < 200 || result.status >= 300) return null;
  try {
    const parsed: unknown = JSON.parse(result.body);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Reads the `code` field TSML's REST API puts on its JSON error bodies (e.g. `feed_restricted`).
function jsonCode(result: CrawlResult): string | null {
  if (result.kind !== "response") return null;
  try {
    const parsed: unknown = JSON.parse(result.body);
    if (typeof parsed === "object" && parsed !== null && "code" in parsed) {
      return typeof parsed.code === "string" ? parsed.code : null;
    }
    return null;
  } catch {
    return null;
  }
}

// Spec §4: a bot check in front of the site is recorded and the site left alone. Probing on would only knock on the
// same wall, and nothing here ever tries to get past one.
function botCheck(result: CrawlResult): Detection | null {
  if (result.kind !== "response") return null;
  const problem = feedProblem({ status: result.status, contentType: result.contentType, body: result.body });
  return problem?.kind === "bot_check"
    ? { feedType: "bot_blocked", feedUrl: null, notes: feedProblemMessage(problem) }
    : null;
}

// Checks a raw href, data-src value or feed URL for a sharing key. detectFeed checks before any URL
// resolution, so a source that carries one is recorded as restricted and never requested (keys are
// never guessed); buildRegistry checks again so a key can never reach the committed registry.
export function hasSharingKey(rawValue: string): boolean {
  return rawValue.includes("key=");
}

// Resolves an href or data-src value against a base URL (typically the homepage's final URL, after
// redirects), without ever throwing on malformed input.
function resolveUrl(value: string, base: string): string | null {
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

// The given website's own URL as a base for every probe: its origin and path (e.g.
// `https://area.org/district5`), normalized with a trailing slash — never just its origin, and never
// carrying a query string or fragment, which would otherwise corrupt the homepage GET.
function siteBase(website: string): string {
  const url = new URL(website);
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${path}`;
}

// Detects a site's meeting feed in the spec §4 order, stopping at the first definite answer. Every
// probe is built from the given website's own URL, normalized with a trailing slash, including any
// path it carries — never from just its origin.
export async function detectFeed(website: string, crawler: Crawler): Promise<Detection> {
  const base = siteBase(website);
  // Every probe's result, so that if nothing definite turns up, the final answer can tell "every probe
  // was blocked by robots.txt" apart from "the site was reachable but had no feed".
  const probeResults: CrawlResult[] = [];
  async function probe(url: string): Promise<CrawlResult> {
    const result = await crawler.get(url);
    probeResults.push(result);
    return result;
  }

  // Step 1: TSML REST feed.
  const restUrl = new URL("wp-json/tsml/meetings", base).toString();
  const restResult = await probe(restUrl);
  const blockedAtRest = botCheck(restResult);
  if (blockedAtRest !== null) return blockedAtRest;
  const restArray = jsonArray(restResult);
  if (restArray !== null) return { feedType: "tsml", feedUrl: restUrl, body: restArray, notes: "" };
  if (
    restResult.kind === "response" &&
    restResult.status === 403 &&
    jsonCode(restResult) === "feed_restricted"
  ) {
    return { feedType: "restricted", feedUrl: restUrl, notes: TSML_RESTRICTED_NOTE };
  }

  // Step 2: legacy TSML AJAX feed.
  const ajaxUrl = new URL("wp-admin/admin-ajax.php?action=meetings", base).toString();
  const ajaxResult = await probe(ajaxUrl);
  const blockedAtAjax = botCheck(ajaxResult);
  if (blockedAtAjax !== null) return blockedAtAjax;
  const ajaxArray = jsonArray(ajaxResult);
  if (ajaxArray !== null) return { feedType: "tsml", feedUrl: ajaxUrl, body: ajaxArray, notes: "" };
  if (ajaxResult.kind === "response" && ajaxResult.status === 401) {
    return { feedType: "restricted", feedUrl: ajaxUrl, notes: TSML_RESTRICTED_NOTE };
  }

  // Steps 3-6 all read the homepage, so fetch it once.
  const homeResult = await probe(base);
  const blockedAtHome = botCheck(homeResult);
  if (blockedAtHome !== null) return blockedAtHome;
  if (homeResult.kind === "response") {
    const root = parse(homeResult.body);
    const homeUrl = homeResult.url;
    // Set (from the raw, unresolved value) when step 3 or step 4 sees a source carrying a sharing key.
    // If no open feed turns up in either step, that's reported as restricted instead of silently
    // falling through to later steps. The key itself is never recorded anywhere, including in the
    // restricted result's feedUrl — a private key must never end up in the registry that gets
    // committed to git.
    let sawKeyedSource = false;

    // Step 3: a Meetings Feed <link>, matched tolerantly: rel carries the "alternate" token, and type
    // and title match case-insensitively.
    const feedLink = root.querySelectorAll("link").find((el) => {
      const relTokens = el.getAttribute("rel")?.toLowerCase().split(/\s+/) ?? [];
      return (
        relTokens.includes("alternate") &&
        el.getAttribute("type")?.toLowerCase() === "application/json" &&
        el.getAttribute("title")?.toLowerCase() === "meetings feed"
      );
    });
    const feedHref = feedLink?.getAttribute("href");
    if (feedHref !== undefined) {
      if (hasSharingKey(feedHref)) {
        sawKeyedSource = true;
      } else {
        const feedUrl = resolveUrl(feedHref, homeUrl);
        if (feedUrl !== null) {
          const feedResult = await probe(feedUrl);
          const array = jsonArray(feedResult);
          if (array !== null) {
            return { feedType: classifyFeedType(feedUrl), feedUrl, body: array, notes: "" };
          }
        }
      }
    }

    // Step 4: the TSML UI's data-src (comma-separated sources).
    const dataSrc = root.querySelector("#tsml-ui")?.getAttribute("data-src");
    if (dataSrc !== undefined) {
      for (const rawSource of dataSrc.split(",")) {
        const source = rawSource.trim();
        if (source === "") continue;
        // Never request a source that carries a sharing key, and never try to guess one. Keep looking
        // at the other sources instead of stopping here.
        if (hasSharingKey(source)) {
          sawKeyedSource = true;
          continue;
        }
        const sourceUrl = resolveUrl(source, homeUrl);
        if (sourceUrl === null) continue;
        const targetUrl = sheetStorageUrl(sourceUrl) ?? sourceUrl;
        const sourceResult = await probe(targetUrl);
        const array = jsonArray(sourceResult);
        if (array !== null) {
          return { feedType: classifyFeedType(targetUrl), feedUrl: targetUrl, body: array, notes: "" };
        }
      }
    }

    if (sawKeyedSource) {
      return { feedType: "restricted", feedUrl: null, notes: TSML_RESTRICTED_NOTE };
    }

    // Step 5: a restricted TSML install with no open feed found above.
    if (root.querySelector('meta[name="12_step_meeting_list"]') !== null) {
      return { feedType: "restricted", feedUrl: null, notes: "TSML installed; sharing restricted" };
    }

    // Step 6: BMLT suspicion, for the manual backlog.
    if (homeResult.body.includes("client_interface")) {
      return { feedType: "none_found", notes: "BMLT suspected" };
    }
  }

  // Step 7: nothing found.
  const allBlocked = probeResults.every((result) => result.kind === "blocked_by_robots");
  return { feedType: "none_found", notes: allBlocked ? "blocked by robots.txt" : "" };
}
