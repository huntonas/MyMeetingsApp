import { parse } from "node-html-parser";

import type { Crawler, CrawlResult } from "./crawler";

export type Detection =
  | {
      feedType: "tsml" | "meeting_guide_json" | "google_sheet";
      feedUrl: string;
      body: unknown;
      notes: string;
    }
  | { feedType: "restricted"; feedUrl: string | null; notes: string }
  | { feedType: "none_found"; notes: string };

const TSML_RESTRICTED_NOTE = "TSML feed restricted; contact the intergroup";

// A 2xx response whose body parses as JSON is a feed; anything else (error status, non-JSON, non-array
// JSON) is not a definite feed, so callers fall through to the next probe in the spec's order.
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

// Rewrites a Google Sheet URL (as published from the TSML UI's `data-src`, or linked from a homepage)
// to the code4recovery storage endpoint that actually serves the meeting JSON. Returns null for any
// URL that isn't a Google Sheet.
export function sheetStorageUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "docs.google.com") return null;
  const match = /^\/spreadsheets\/d\/([^/]+)/.exec(parsed.pathname);
  const id = match?.[1];
  if (id === undefined) return null;
  return `https://sheets.code4recovery.org/storage/${id}.json`;
}

// Detects a site's meeting feed in the spec §4 order, stopping at the first definite answer. Every
// probe is relative to the site's origin, ignoring any path on `website` itself.
export async function detectFeed(website: string, crawler: Crawler): Promise<Detection> {
  const origin = new URL(website).origin;
  // Every probe's result, so that if nothing definite turns up, the final answer can tell "every probe
  // was blocked by robots.txt" apart from "the site was reachable but had no feed".
  const probeResults: CrawlResult[] = [];
  async function probe(url: string): Promise<CrawlResult> {
    const result = await crawler.get(url);
    probeResults.push(result);
    return result;
  }

  // Step 1: TSML REST feed.
  const restUrl = `${origin}/wp-json/tsml/meetings`;
  const restResult = await probe(restUrl);
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
  const ajaxUrl = `${origin}/wp-admin/admin-ajax.php?action=meetings`;
  const ajaxResult = await probe(ajaxUrl);
  const ajaxArray = jsonArray(ajaxResult);
  if (ajaxArray !== null) return { feedType: "tsml", feedUrl: ajaxUrl, body: ajaxArray, notes: "" };
  if (ajaxResult.kind === "response" && ajaxResult.status === 401) {
    return { feedType: "restricted", feedUrl: ajaxUrl, notes: TSML_RESTRICTED_NOTE };
  }

  // Steps 3-6 all read the homepage, so fetch it once.
  const homeResult = await probe(origin);
  if (homeResult.kind === "response") {
    const root = parse(homeResult.body);
    const homeUrl = homeResult.url;

    // Step 3: a Meetings Feed <link>.
    const feedLink = root
      .querySelectorAll("link")
      .find(
        (el) =>
          el.getAttribute("rel") === "alternate" &&
          el.getAttribute("type") === "application/json" &&
          el.getAttribute("title") === "Meetings Feed",
      );
    const feedHref = feedLink?.getAttribute("href");
    if (feedHref !== undefined) {
      const feedUrl = new URL(feedHref, homeUrl).toString();
      const feedResult = await probe(feedUrl);
      const array = jsonArray(feedResult);
      if (array !== null) {
        const feedType =
          new URL(feedUrl).host === "sheets.code4recovery.org" ? "google_sheet" : "meeting_guide_json";
        return { feedType, feedUrl, body: array, notes: "" };
      }
    }

    // Step 4: the TSML UI's data-src (comma-separated sources).
    const dataSrc = root.querySelector("#tsml-ui")?.getAttribute("data-src");
    if (dataSrc !== undefined) {
      for (const rawSource of dataSrc.split(",")) {
        const source = rawSource.trim();
        if (source === "") continue;
        const sourceUrl = new URL(source, homeUrl).toString();
        // Never request a source that carries a sharing key, and never try to guess one.
        if (source.includes("key=")) {
          return { feedType: "restricted", feedUrl: sourceUrl, notes: TSML_RESTRICTED_NOTE };
        }
        const sheetUrl = sheetStorageUrl(sourceUrl);
        const targetUrl = sheetUrl ?? sourceUrl;
        const sourceResult = await probe(targetUrl);
        const array = jsonArray(sourceResult);
        if (array !== null) {
          return {
            feedType: sheetUrl !== null ? "google_sheet" : "meeting_guide_json",
            feedUrl: targetUrl,
            body: array,
            notes: "",
          };
        }
      }
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
