import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RegistryEntry } from "@mymeetingapp/feed-kit";
import { startServer } from "@mymeetingapp/test-server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runNa } from "../src/na-run";
import { readRegistry, writeRegistry } from "../src/registry-file";

const json = { "Content-Type": "application/json" };
const servers: { close(): Promise<void> }[] = [];
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "feed-discovery-na-test-"));
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await rm(dir, { recursive: true, force: true });
});

const aaEntry: RegistryEntry = {
  id: "tn-intergroup",
  name: "Tennessee Area Intergroup",
  entity_type: "intergroup",
  state: "TN",
  website: "https://example.org",
  feed_type: "tsml",
  feed_url: "https://example.org/wp-json/tsml/meetings",
  verified: true,
  meeting_count: 120,
  states_covered: ["TN"],
  cities_covered: [],
  checked_at: "2026-09-25",
  notes: "",
};

// The Show-Me region as an earlier discover:na run wrote it; the owner has since opted it out.
function showMePrevious(base: string): RegistryEntry {
  return {
    id: "show-me-region-na",
    name: "Show-Me Region",
    entity_type: "region",
    fellowship: "na",
    state: "MO",
    website: base,
    feed_type: "bmlt",
    feed_url: `${base}/mo/main_server/client_interface/json/?switcher=GetSearchResults`,
    verified: true,
    meeting_count: 1,
    states_covered: ["MO"],
    cities_covered: ["St. Louis, MO"],
    checked_at: "2026-09-25",
    notes: "",
    opted_out: true,
  };
}

function row(root: string, id: string, province: string, city: string) {
  return {
    id_bigint: id,
    meeting_name: "Meeting",
    weekday_tinyint: "2",
    start_time: "19:00:00",
    location_municipality: city,
    location_province: province,
    root_server_uri: root,
  };
}

describe("runNa", () => {
  it("writes one NA region per U.S. root server, keeps AA entries and carries an opt-out", async () => {
    let base = "";
    const server = await startServer((path) => {
      if (path === "/servers.json") {
        return {
          status: 200,
          headers: json,
          body: JSON.stringify([
            { id: "1", name: "Volunteer Region", url: `${base}/tn/main_server/` },
            { id: "2", name: "NA New Zealand", url: `${base}/nz/main_server/` },
            { id: "3", name: "Show-Me Region", url: `${base}/mo/main_server/` },
          ]),
        };
      }
      const root = path.split("/client_interface")[0] ?? "";
      const rows =
        root === "/tn/main_server"
          ? [
              row(`${base}/tn/main_server`, "1", "TN", "Nashville"),
              row(`${base}/tn/main_server`, "2", "Tennessee", "Memphis"),
            ]
          : root === "/nz/main_server"
            ? [row(`${base}/nz/main_server`, "3", "Auckland", "Auckland")]
            : [row(`${base}/mo/main_server`, "4", "MO", "St. Louis")];
      return { status: 200, headers: json, body: JSON.stringify({ meetings: rows, formats: [] }) };
    });
    servers.push(server);
    base = server.baseUrl;
    const registryPath = join(dir, "registry.yaml");
    await writeRegistry(registryPath, [aaEntry, showMePrevious(base)]);

    expect(await runNa({ serverListUrl: `${base}/servers.json`, outDir: dir })).toEqual({
      servers: 2,
      meetings: 3,
    });

    const registry = await readRegistry(registryPath);
    expect(
      registry.map((entry) => [entry.id, entry.fellowship, entry.state, entry.opted_out]).sort(),
    ).toEqual([
      ["show-me-region-na", "na", "MO", true],
      ["tn-intergroup", undefined, "TN", undefined],
      ["volunteer-region-na", "na", "TN", undefined],
    ]);
    expect(registry.find((entry) => entry.id === "volunteer-region-na")).toMatchObject({
      entity_type: "region",
      feed_type: "bmlt",
      verified: true,
      meeting_count: 2,
      states_covered: ["TN"],
      cities_covered: ["Memphis, TN", "Nashville, TN"],
    });
  });
});
