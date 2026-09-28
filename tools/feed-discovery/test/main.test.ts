import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RegistryEntry } from "@mymeetingapp/feed-kit";
import { startServer } from "@mymeetingapp/test-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { run } from "../src/main";
import { readRegistry, writeRegistry } from "../src/registry-file";

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
    const registry = RegistryEntry.array().parse(parse(registryRaw));
    expect(registry.map((entry) => entry.feed_type).sort()).toEqual(["restricted", "tsml"]);

    const coverage = await readFile(join(dir, "coverage.md"), "utf-8");
    const restrictedSection =
      coverage.split("## Restricted feeds (contact the intergroup)")[1]?.split("##")[0] ?? "";
    expect(restrictedSection).toContain("Closed Intergroup");
    expect(restrictedSection).not.toContain("Open Intergroup");
  });

  it("records an entity with no website as none_found without requesting anything for it", async () => {
    const directory = await directoryServer(
      '<div class="area-loc-item"><h3>Vermont Central Office</h3><address> Montpelier , Vermont </address></div>',
    );

    await run({ states: ["VT"], directoryUrl: directory.baseUrl, outDir: dir });

    const registry = RegistryEntry.array().parse(parse(await readFile(join(dir, "registry.yaml"), "utf-8")));
    expect(registry).toMatchObject([
      {
        id: "vermont-central-office-montpelier-vt",
        website: null,
        feed_type: "none_found",
        notes: "no website listed",
      },
    ]);
    expect(directory.requests.map((r) => r.path)).toEqual(["/robots.txt", "/?state=VT"]);
  });

  it("fails, naming the state and writing nothing, when a directory page can't be read", async () => {
    const directory = await startServer((path) =>
      path.startsWith("/?state=VT")
        ? { status: 200, body: '<div class="area-loc-item"><h3>Vermont Office</h3></div>' }
        : { status: path === "/robots.txt" ? 404 : 500, body: "" },
    );
    servers.push(directory);

    await expect(run({ states: ["VT", "NH"], directoryUrl: directory.baseUrl, outDir: dir })).rejects.toThrow(
      /NH/,
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it("fails, writing nothing, when a state that had registry entries now lists none", async () => {
    const directory = await startServer((path) =>
      path === "/robots.txt"
        ? { status: 404, body: "" }
        : { status: 200, body: "<p>Checking your browser</p>" },
    );
    servers.push(directory);
    const previous = RegistryEntry.parse({
      id: "vermont-office-burlington-vt",
      name: "Vermont Office",
      entity_type: "central_office",
      state: "VT",
      website: null,
      feed_type: "none_found",
      feed_url: null,
      verified: false,
      meeting_count: 0,
      states_covered: [],
      checked_at: "2026-08-01",
      notes: "no website listed",
    });
    await writeRegistry(join(dir, "registry.yaml"), [previous]);

    await expect(run({ states: ["VT"], directoryUrl: directory.baseUrl, outDir: dir })).rejects.toThrow(/VT/);
    expect(await readdir(dir)).toEqual(["registry.yaml"]);
    expect(await readRegistry(join(dir, "registry.yaml"))).toEqual([previous]);
  });
});
