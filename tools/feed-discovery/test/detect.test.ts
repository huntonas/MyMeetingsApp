import { startServer } from "@mymeetingapp/test-server";
import { afterEach, describe, expect, it } from "vitest";

import { createCrawler } from "../src/crawler";
import { classifyFeedType, detectFeed, sheetStorageUrl } from "../src/detect";

type Routes = Record<string, { status: number; body?: string; headers?: Record<string, string> }>;
const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
const json = { "Content-Type": "application/json" };
const meetings = JSON.stringify([{ slug: "a", name: "A", day: 1, time: "19:00" }]);

async function site(routes: Routes) {
  const server = await startServer(
    (path) => routes[path] ?? { status: 404, body: '{"code":"rest_no_route"}', headers: json },
  );
  servers.push(server);
  return server;
}

describe("detectFeed", () => {
  it("finds an open TSML REST feed first", async () => {
    const s = await site({ "/wp-json/tsml/meetings": { status: 200, body: meetings, headers: json } });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({
      feedType: "tsml",
      feedUrl: `${s.baseUrl}/wp-json/tsml/meetings`,
    });
  });

  it("detects a feed served under the website's own path", async () => {
    const s = await site({ "/aa/wp-json/tsml/meetings": { status: 200, body: meetings, headers: json } });
    expect(await detectFeed(`${s.baseUrl}/aa`, createCrawler())).toMatchObject({
      feedType: "tsml",
      feedUrl: `${s.baseUrl}/aa/wp-json/tsml/meetings`,
    });
  });

  it("does not credit a root-only feed to a website served under a path", async () => {
    const s = await site({ "/wp-json/tsml/meetings": { status: 200, body: meetings, headers: json } });
    expect(await detectFeed(`${s.baseUrl}/aa`, createCrawler())).toEqual({
      feedType: "none_found",
      notes: "",
    });
  });

  it("drops a query string and fragment from the website when building the base", async () => {
    const s = await site({
      "/": { status: 200, body: '<div id="tsml-ui" data-src="/feed.json"></div>' },
      "/feed.json": { status: 200, body: meetings, headers: json },
    });
    expect(await detectFeed(`${s.baseUrl}/?p=1#frag`, createCrawler())).toMatchObject({
      feedType: "meeting_guide_json",
      feedUrl: `${s.baseUrl}/feed.json`,
    });
  });

  it("records a restricted TSML REST feed and stops probing", async () => {
    const s = await site({
      "/wp-json/tsml/meetings": {
        status: 403,
        body: '{"code":"feed_restricted","message":"This meeting list is restricted."}',
        headers: json,
      },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toEqual({
      feedType: "restricted",
      feedUrl: `${s.baseUrl}/wp-json/tsml/meetings`,
      notes: "TSML feed restricted; contact the intergroup",
    });
    expect(s.requests.map((r) => r.path)).not.toContain("/wp-admin/admin-ajax.php?action=meetings");
  });

  it("falls back to the legacy AJAX feed", async () => {
    const s = await site({
      "/wp-admin/admin-ajax.php?action=meetings": { status: 200, body: meetings, headers: json },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({
      feedType: "tsml",
      feedUrl: `${s.baseUrl}/wp-admin/admin-ajax.php?action=meetings`,
    });
  });

  it("records a restricted AJAX feed", async () => {
    const s = await site({
      "/wp-admin/admin-ajax.php?action=meetings": {
        status: 401,
        body: '{"error":"HTTP/1.1 401 Unauthorized"}',
        headers: json,
      },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({ feedType: "restricted" });
  });

  it("follows a Meetings Feed link on the homepage", async () => {
    const s = await site({
      "/": {
        status: 200,
        body: '<link rel="alternate" type="application/json" title="Meetings Feed" href="/feed.json">',
      },
      "/feed.json": { status: 200, body: meetings, headers: json },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({
      feedType: "meeting_guide_json",
      feedUrl: `${s.baseUrl}/feed.json`,
    });
  });

  it("falls through to the next step when the linked feed isn't a JSON array", async () => {
    const s = await site({
      "/": {
        status: 200,
        body:
          '<link rel="alternate" type="application/json" title="Meetings Feed" href="/feed.json">' +
          '<meta name="12_step_meeting_list" content="1">',
      },
      "/feed.json": { status: 200, body: "{}", headers: json },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toEqual({
      feedType: "restricted",
      feedUrl: null,
      notes: "TSML installed; sharing restricted",
    });
  });

  it("matches the Meetings Feed link tolerantly (rel token, type, title case-insensitive)", async () => {
    const s = await site({
      "/": {
        status: 200,
        body: '<link rel="ALTERNATE stylesheet" type="Application/JSON" title="meetings feed" href="/feed.json">',
      },
      "/feed.json": { status: 200, body: meetings, headers: json },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({
      feedType: "meeting_guide_json",
      feedUrl: `${s.baseUrl}/feed.json`,
    });
  });

  it("treats a keyed Meetings Feed link as restricted and never fetches it", async () => {
    const s = await site({
      "/": {
        status: 200,
        body: '<link rel="alternate" type="application/json" title="Meetings Feed" href="/feed.json?key=abc">',
      },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({ feedType: "restricted" });
    expect(s.requests.map((r) => r.path)).not.toContain("/feed.json?key=abc");
  });

  it("never stores a keyed Meetings Feed link's URL, even in the restricted result", async () => {
    const s = await site({
      "/": {
        status: 200,
        body: '<link rel="alternate" type="application/json" title="Meetings Feed" href="/feed.json?key=abc">',
      },
    });
    const result = await detectFeed(s.baseUrl, createCrawler());
    expect(result).toEqual({
      feedType: "restricted",
      feedUrl: null,
      notes: "TSML feed restricted; contact the intergroup",
    });
    expect(JSON.stringify(result)).not.toContain("key=");
  });

  it("resolves a relative data-src against the homepage's URL after a redirect", async () => {
    const s = await site({
      "/": { status: 301, headers: { Location: "/home/" } },
      "/home/": { status: 200, body: '<div id="tsml-ui" data-src="feed.json"></div>' },
      "/home/feed.json": { status: 200, body: meetings, headers: json },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({
      feedType: "meeting_guide_json",
      feedUrl: `${s.baseUrl}/home/feed.json`,
    });
  });

  it("treats a TSML UI source that carries a sharing key as restricted and never fetches it", async () => {
    const s = await site({
      "/": {
        status: 200,
        body: '<div id="tsml-ui" data-src="/wp-admin/admin-ajax.php?action=meetings&key=abc"></div>',
      },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({ feedType: "restricted" });
    expect(s.requests.map((r) => r.path)).not.toContain("/wp-admin/admin-ajax.php?action=meetings&key=abc");
  });

  it("skips a keyed data-src source and uses the next open source", async () => {
    const s = await site({
      "/": {
        status: 200,
        body: '<div id="tsml-ui" data-src="/private.json?key=abc,/feed.json"></div>',
      },
      "/feed.json": { status: 200, body: meetings, headers: json },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({
      feedType: "meeting_guide_json",
      feedUrl: `${s.baseUrl}/feed.json`,
    });
    expect(s.requests.map((r) => r.path)).not.toContain("/private.json?key=abc");
  });

  it("never stores a keyed data-src source's URL, even in the restricted result", async () => {
    const s = await site({
      "/": {
        status: 200,
        body: '<div id="tsml-ui" data-src="/wp-admin/admin-ajax.php?action=meetings&key=abc"></div>',
      },
    });
    const result = await detectFeed(s.baseUrl, createCrawler());
    expect(result).toEqual({
      feedType: "restricted",
      feedUrl: null,
      notes: "TSML feed restricted; contact the intergroup",
    });
    expect(JSON.stringify(result)).not.toContain("key=");
  });

  it("treats an unparseable keyed data-src source as restricted too", async () => {
    const s = await site({
      "/": { status: 200, body: '<div id="tsml-ui" data-src="https://[x?key=abc"></div>' },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toEqual({
      feedType: "restricted",
      feedUrl: null,
      notes: "TSML feed restricted; contact the intergroup",
    });
  });

  it("finds nothing without throwing when a link href and data-src are malformed", async () => {
    const s = await site({
      "/": {
        status: 200,
        body:
          '<link rel="alternate" type="application/json" title="Meetings Feed" href="https://[x">' +
          '<div id="tsml-ui" data-src="//"></div>',
      },
    });
    await expect(detectFeed(s.baseUrl, createCrawler())).resolves.toEqual({
      feedType: "none_found",
      notes: "",
    });
  });

  it("reports TSML installed with sharing restricted", async () => {
    const s = await site({
      "/": { status: 200, body: '<meta name="12_step_meeting_list" content="3.19.19">' },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toEqual({
      feedType: "restricted",
      feedUrl: null,
      notes: "TSML installed; sharing restricted",
    });
  });

  it("notes a suspected BMLT site for the manual backlog", async () => {
    const s = await site({
      "/": {
        status: 200,
        body: '<script src="https://bmlt.example/main_server/client_interface/jsonp/"></script>',
      },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toEqual({
      feedType: "none_found",
      notes: "BMLT suspected",
    });
  });

  it("finds nothing on a plain site", async () => {
    const s = await site({ "/": { status: 200, body: "<p>Call us</p>" } });
    expect(await detectFeed(s.baseUrl, createCrawler())).toEqual({ feedType: "none_found", notes: "" });
  });

  it("notes a site that blocks all probes in robots.txt", async () => {
    const s = await site({ "/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /" } });
    expect(await detectFeed(s.baseUrl, createCrawler())).toEqual({
      feedType: "none_found",
      notes: "blocked by robots.txt",
    });
    expect(s.requests.map((r) => r.path)).toEqual(["/robots.txt"]);
  });
});

describe("sheetStorageUrl", () => {
  it("rewrites a Google Sheet edit URL to its code4recovery storage URL", () => {
    expect(sheetStorageUrl("https://docs.google.com/spreadsheets/d/1AbCdEf23/edit#gid=0")).toBe(
      "https://sheets.code4recovery.org/storage/1AbCdEf23.json",
    );
  });

  it("returns null for a URL that isn't a Google Sheet", () => {
    expect(sheetStorageUrl("https://example.org/feed.json")).toBeNull();
  });
});

describe("classifyFeedType", () => {
  it("classifies a code4recovery storage URL as a google sheet feed", () => {
    expect(classifyFeedType("https://sheets.code4recovery.org/storage/1AbCdEf23.json")).toBe("google_sheet");
  });

  it("classifies any other feed URL as meeting_guide_json", () => {
    expect(classifyFeedType("https://example.org/feed.json")).toBe("meeting_guide_json");
  });
});
