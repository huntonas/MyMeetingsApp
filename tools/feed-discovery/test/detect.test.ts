import { readFileSync } from "node:fs";
import nodePath from "node:path";

import { startServer } from "@mymeetingapp/test-server";
import { afterEach, describe, expect, it } from "vitest";

import { createCrawler } from "../src/crawler";
import { detectFeed } from "../src/detect";

type Routes = Record<string, { status: number; body?: string; headers?: Record<string, string> }>;
const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
const json = { "Content-Type": "application/json" };
const meetings = JSON.stringify([{ slug: "a", name: "A", day: 1, time: "19:00" }]);
const fixture = (name: string) =>
  readFileSync(
    nodePath.resolve(import.meta.dirname, "../../../packages/feed-kit/test/fixtures", name),
    "utf8",
  );

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
    // Detection stops there: the homepage and anything after it are never requested.
    expect(s.requests.map((r) => r.path)).toEqual([
      "/robots.txt",
      "/wp-json/tsml/meetings",
      "/wp-admin/admin-ajax.php?action=meetings",
    ]);
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

  it.each([
    ["Cloudflare", 403, "cloudflare-challenge.html"],
    ["Incapsula", 200, "incapsula-challenge.html"],
  ])("records a site behind a %s bot check and stops probing it", async (by, status, file) => {
    const s = await site({
      "/wp-json/tsml/meetings": { status, body: fixture(file), headers: { "Content-Type": "text/html" } },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toEqual({
      feedType: "bot_blocked",
      feedUrl: null,
      notes: `blocked by a bot check (${by})`,
    });
    // Spec §4: one honest request, then nothing more to that site, and never a second User-Agent.
    expect(s.requests.map((r) => r.path)).toEqual(["/robots.txt", "/wp-json/tsml/meetings"]);
    expect(new Set(s.requests.map((r) => r.headers["user-agent"]))).toEqual(
      new Set(["mymeetingapp/1.0 (+https://mymeetings.app; admin@goodersoftwarellc.com)"]),
    );
  });

  it("still records TSML's own JSON restriction as restricted, not as a bot check", async () => {
    const s = await site({
      "/wp-json/tsml/meetings": { status: 403, body: fixture("tsml-restricted.json"), headers: json },
    });
    expect(await detectFeed(s.baseUrl, createCrawler())).toMatchObject({ feedType: "restricted" });
  });
});
