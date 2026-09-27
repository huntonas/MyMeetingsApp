import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "@mymeetingapp/test-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { run } from "../src/main";

type Routes = Record<string, { status: number; body?: string; headers?: Record<string, string> }>;

const servers: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const json = { "Content-Type": "application/json" };
const meetings = JSON.stringify([{ slug: "a", name: "A", day: 1, time: "19:00" }]);

async function siteServer(routes: Routes) {
  const server = await startServer(
    (path) => routes[path] ?? { status: 404, body: '{"code":"rest_no_route"}', headers: json },
  );
  servers.push(server);
  return server;
}

async function directoryServer(html: string) {
  const server = await startServer((path) =>
    path.startsWith("/?state=VT") ? { status: 200, body: html } : { status: 404, body: "" },
  );
  servers.push(server);
  return server;
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "feed-discovery-main-test-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("run", () => {
  it("crawls a state directory, detects and verifies feeds, and writes the registry and coverage report", async () => {
    const site = await siteServer({
      "/open/wp-json/tsml/meetings": { status: 200, body: meetings, headers: json },
      "/closed/wp-json/tsml/meetings": {
        status: 403,
        body: '{"code":"feed_restricted","message":"This meeting list is restricted."}',
        headers: json,
      },
    });
    const html = `
<div class="area-loc-item"><h3>Open Intergroup</h3><address> Anytown , Vermont </address>
<p><a href="${site.baseUrl}/open">${site.baseUrl}/open</a></p></div>
<div class="area-loc-item"><h3>Closed Intergroup</h3><address> Anytown , Vermont </address>
<p><a href="${site.baseUrl}/closed">${site.baseUrl}/closed</a></p></div>`;
    const directory = await directoryServer(html);

    const result = await run({ states: ["VT"], directoryUrl: directory.baseUrl, outDir: dir });

    expect(result).toEqual({ entities: 2, verified: 1 });

    const registryRaw = await readFile(join(dir, "registry.yaml"), "utf-8");
    const registry = parse(registryRaw) as { name: string; feed_type: string }[];
    expect(registry.map((entry) => entry.feed_type).sort()).toEqual(["restricted", "tsml"]);

    const coverage = await readFile(join(dir, "coverage.md"), "utf-8");
    const restrictedSection =
      coverage.split("## Restricted feeds (contact the intergroup)")[1]?.split("##")[0] ?? "";
    expect(restrictedSection).toContain("Closed Intergroup");
    expect(restrictedSection).not.toContain("Open Intergroup");
  });
});
