import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RegistryEntry } from "@mymeetingapp/feed-kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRegistry, writeRegistry } from "../src/registry-file";

const entryA: RegistryEntry = {
  id: "some-county-intergroup",
  name: "Some County Intergroup",
  entity_type: "intergroup",
  state: "TN",
  website: "https://example.org",
  feed_type: "tsml",
  feed_url: "https://example.org/wp-admin/admin-ajax.php?action=meetings",
  verified: true,
  meeting_count: 612,
  states_covered: ["TN"],
  cities_covered: ["Nashville, TN"],
  checked_at: "2026-09-25",
  notes: "",
};

const entryB: RegistryEntry = {
  id: "vermont-office",
  name: "Vermont Office",
  entity_type: "central_office",
  state: "VT",
  website: null,
  feed_type: "none_found",
  feed_url: null,
  verified: false,
  meeting_count: 0,
  states_covered: [],
  cities_covered: [],
  checked_at: "2026-09-25",
  notes: "no website listed",
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "registry-file-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeRegistry / readRegistry", () => {
  it("round-trips entries and their sorted order through a temp file", async () => {
    const path = join(dir, "registry.yaml");
    // Passed in state/id order (VT before TN) so the round trip proves writeRegistry sorted them.
    await writeRegistry(path, [entryB, entryA]);
    const read = await readRegistry(path);
    expect(read).toEqual([entryA, entryB]);
  });

  it("reads a missing file as an empty list", async () => {
    const read = await readRegistry(join(dir, "does-not-exist.yaml"));
    expect(read).toEqual([]);
  });

  it("throws, naming the entry's id, when an entry in the file is invalid", async () => {
    const path = join(dir, "registry.yaml");
    await writeFile(path, "- id: bad-entry\n  meeting_count: -1\n", "utf-8");
    await expect(readRegistry(path)).rejects.toThrow(/bad-entry/);
  });

  it("refuses to write a registry holding an invalid entry, leaving no file behind", async () => {
    const path = join(dir, "registry.yaml");
    await expect(writeRegistry(path, [entryA, { ...entryB, id: "" }])).rejects.toThrow();
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
