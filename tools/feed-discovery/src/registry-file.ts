import { readFile, writeFile } from "node:fs/promises";

import { parseRegistry, RegistryEntry } from "@mymeetingapp/feed-kit";
import { stringify } from "yaml";

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

// Reads tools/feed-discovery/registry.yaml (spec §4). Missing file reads as an empty registry -
// there simply isn't one yet on a first run.
export async function readRegistry(path: string): Promise<RegistryEntry[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return [];
    throw error;
  }
  return parseRegistry(raw);
}

// The spec's key order, one line per entity. `opted_out` is written last and only when true.
function orderedKeys(entry: RegistryEntry): Record<string, unknown> {
  const base = {
    id: entry.id,
    name: entry.name,
    entity_type: entry.entity_type,
    state: entry.state,
    website: entry.website,
    feed_type: entry.feed_type,
    feed_url: entry.feed_url,
    verified: entry.verified,
    meeting_count: entry.meeting_count,
    states_covered: entry.states_covered,
    checked_at: entry.checked_at,
    notes: entry.notes,
  };
  return entry.opted_out === true ? { ...base, opted_out: true } : base;
}

function sortKey(entry: RegistryEntry): string {
  return `${entry.state}|${entry.id}`;
}

// Writes tools/feed-discovery/registry.yaml (spec §4), sorted by state then id so diffs stay small
// and reviewable from month to month. Every entry is validated first, so a run that produced a bad
// entry fails before writing anything rather than committing a registry the next run can't read.
export async function writeRegistry(path: string, entries: RegistryEntry[]): Promise<void> {
  const sorted = entries
    .map((entry) => RegistryEntry.parse(entry))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  await writeFile(path, stringify(sorted.map(orderedKeys)), "utf-8");
}
