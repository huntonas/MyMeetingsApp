import type { RegistryEntry } from "@mymeetingapp/feed-kit";

import { hasSharingKey, type Detection } from "./detect";
import type { DirectoryEntity } from "./directory";
import type { VerifyResult } from "./verify";

export interface Overlap {
  a: string;
  b: string;
  shared: number;
}

interface CountDrop {
  id: string;
  from: number;
  to: number;
}

export interface Changes {
  stoppedResponding: string[];
  removedFromDirectory: string[];
  newEntities: string[];
  countDrops: CountDrop[];
}

// A meeting-count drop over this fraction (spec §4 re-verification) is worth flagging in the report.
const COUNT_DROP_THRESHOLD = 0.3;

// A detection's own feed URL, before the sharing-key guard below. `none_found` never carries one.
function detectionFeedUrl(detection: Detection): string | null {
  return detection.feedType === "none_found" ? null : detection.feedUrl;
}

// One registry entry (spec §4) per discovered entity. `opted_out: true` survives from `previous` by
// id, since re-running discovery must never silently re-enable a feed someone opted out of; an
// opted-out entry the directory no longer lists is carried forward unchanged, so the opt-out isn't lost
// if the entity reappears later.
export function buildRegistry(
  found: { entity: DirectoryEntity; detection: Detection; verification: VerifyResult | null }[],
  previous: RegistryEntry[],
  checkedAt: string,
): RegistryEntry[] {
  const previousById = new Map(previous.map((entry) => [entry.id, entry]));

  const foundIds = new Set(found.map(({ entity }) => entity.id));
  const carriedOptOuts = previous.filter((entry) => entry.opted_out === true && !foundIds.has(entry.id));

  const entries = found.map(({ entity, detection, verification }) => {
    const rawFeedUrl = detectionFeedUrl(detection);
    // Belt and braces on top of detectFeed's own guarantee that a keyed source is never fetched: a
    // feed_url carrying a sharing key must never reach the registry that gets committed to git.
    const feedUrl = rawFeedUrl !== null && hasSharingKey(rawFeedUrl) ? null : rawFeedUrl;

    const entry: RegistryEntry = {
      id: entity.id,
      name: entity.name,
      entity_type: entity.entityType,
      state: entity.state,
      website: entity.website,
      feed_type: detection.feedType,
      feed_url: feedUrl,
      verified: verification?.verified ?? false,
      meeting_count: verification?.meetingCount ?? 0,
      states_covered: verification?.statesCovered ?? [],
      checked_at: checkedAt,
      notes: detection.notes,
    };

    return previousById.get(entity.id)?.opted_out === true ? { ...entry, opted_out: true } : entry;
  });
  return [...entries, ...carriedOptOuts];
}

// Pairs of feeds that cover at least one of the same meetings, highest overlap first - a sign the two
// entities are publishing duplicate or umbrella feeds for the same territory.
export function computeOverlaps(keysByFeed: Map<string, Set<string>>): Overlap[] {
  const ids = [...keysByFeed.keys()];
  const overlaps: Overlap[] = [];

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      if (a === undefined || b === undefined) continue;
      const keysA = keysByFeed.get(a);
      const keysB = keysByFeed.get(b);
      if (keysA === undefined || keysB === undefined) continue;

      let shared = 0;
      for (const key of keysA) {
        if (keysB.has(key)) shared += 1;
      }
      if (shared > 0) overlaps.push({ a, b, shared });
    }
  }

  return overlaps.sort((x, y) => y.shared - x.shared);
}

// Spec §4 re-verification: feeds that stopped responding, entities that left or joined the directory,
// and meeting-count drops worth a human's attention.
export function computeChanges(previous: RegistryEntry[], current: RegistryEntry[]): Changes {
  const previousById = new Map(previous.map((entry) => [entry.id, entry]));
  const currentById = new Map(current.map((entry) => [entry.id, entry]));

  const stoppedResponding = previous
    .filter((entry) => entry.verified && currentById.get(entry.id)?.verified === false)
    .map((entry) => entry.id);

  const removedFromDirectory = previous
    .filter((entry) => !currentById.has(entry.id))
    .map((entry) => entry.id);

  const newEntities = current.filter((entry) => !previousById.has(entry.id)).map((entry) => entry.id);

  const countDrops: CountDrop[] = [];
  for (const entry of current) {
    const before = previousById.get(entry.id);
    if (before === undefined || before.meeting_count === 0) continue;
    const drop = (before.meeting_count - entry.meeting_count) / before.meeting_count;
    if (drop > COUNT_DROP_THRESHOLD) {
      countDrops.push({ id: entry.id, from: before.meeting_count, to: entry.meeting_count });
    }
  }

  return { stoppedResponding, removedFromDirectory, newEntities, countDrops };
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join(" | ")} |`;
  const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`;
  return [line(headers), separator, ...rows.map(line)].join("\n");
}

function listOrNone(items: string[]): string {
  return items.length === 0 ? "None." : items.map((item) => `- ${item}`).join("\n");
}

function backlogLine(entry: RegistryEntry): string {
  return `${entry.name} (${entry.state}) — ${entry.website ?? "no website listed"}`;
}

// The markdown for tools/feed-discovery/coverage.md (spec §4): a per-state summary, restricted feeds
// (the manual "contact the intergroup" list), entities with no feed found (the manual backlog),
// overlapping feeds, and changes since the last run.
export function renderCoverage(entries: RegistryEntry[], overlaps: Overlap[], changes: Changes): string {
  const checkedAt = entries[0]?.checked_at ?? "";
  const verifiedCount = entries.filter((entry) => entry.verified).length;
  const totalMeetings = entries.reduce((sum, entry) => sum + entry.meeting_count, 0);

  const states = [...new Set(entries.map((entry) => entry.state))].sort();
  const rows = states.map((state) => {
    const stateEntries = entries.filter((entry) => entry.state === state);
    return [
      state,
      String(stateEntries.length),
      String(stateEntries.filter((entry) => entry.verified).length),
      String(stateEntries.reduce((sum, entry) => sum + entry.meeting_count, 0)),
      String(stateEntries.filter((entry) => entry.feed_type === "restricted").length),
      String(stateEntries.filter((entry) => entry.feed_type === "none_found").length),
    ];
  });

  const restricted = entries.filter((entry) => entry.feed_type === "restricted");
  const noFeed = entries.filter((entry) => entry.feed_type === "none_found");

  const changeLines = [
    changes.stoppedResponding.length > 0 ? `Stopped responding: ${changes.stoppedResponding.join(", ")}` : "",
    changes.removedFromDirectory.length > 0
      ? `Removed from the directory: ${changes.removedFromDirectory.join(", ")}`
      : "",
    changes.newEntities.length > 0 ? `New entities: ${changes.newEntities.join(", ")}` : "",
    ...changes.countDrops.map(
      (drop) => `${drop.id}: meeting count dropped from ${String(drop.from)} to ${String(drop.to)}`,
    ),
  ].filter((line) => line !== "");

  const blocks = [
    "# Feed coverage",
    `Checked ${checkedAt}. ${String(entries.length)} entities, ${String(verifiedCount)} verified feed${
      verifiedCount === 1 ? "" : "s"
    }, ${String(totalMeetings)} meetings.`,
    renderTable(["State", "Entities", "Verified feeds", "Meetings", "Restricted", "No feed"], rows),
    `## Restricted feeds (contact the intergroup)\n\n${listOrNone(restricted.map(backlogLine))}`,
    `## No feed found (manual backlog)\n\n${listOrNone(noFeed.map(backlogLine))}`,
    `## Overlapping feeds\n\n${listOrNone(
      overlaps.map((overlap) => `${overlap.a} and ${overlap.b} — ${String(overlap.shared)} shared meetings`),
    )}`,
    `## Changes since the last run\n\n${listOrNone(changeLines)}`,
  ];

  return blocks.join("\n\n");
}
