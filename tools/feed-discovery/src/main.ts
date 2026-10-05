import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createCrawler } from "./crawler";
import { detectFeed, type Detection } from "./detect";
import { parseDirectoryPage, type DirectoryEntity } from "./directory";
import { runNa } from "./na-run";
import { readRegistry, writeRegistry } from "./registry-file";
import { buildRegistry, computeChanges, computeOverlaps, renderCoverage } from "./report";
import { US_STATES } from "./states";
import { verifyFeed, type VerifyResult } from "./verify";

const DEFAULT_DIRECTORY_URL = "https://www.aa.org/find-aa/north-america";
// Spec §4: run several entities' feed checks at once; the crawler's own per-host throttle keeps any
// one site to one request per second regardless of this number.
const CONCURRENCY = 8;
// The tool's own directory (the parent of src/), so `pnpm --filter feed-discovery discover` writes
// registry.yaml and coverage.md next to this package by default.
const TOOL_DIR = fileURLToPath(new URL("..", import.meta.url));

export interface RunOptions {
  states?: string[];
  directoryUrl?: string;
  outDir?: string;
}

export interface RunResult {
  entities: number;
  verified: number;
}

// Runs up to `limit` calls to `fn` concurrently over `items`, waiting for all of them to settle.
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      if (item !== undefined) await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function hasWebsite(entity: DirectoryEntity): entity is DirectoryEntity & { website: string } {
  return entity.website !== null;
}

function hasBody(detection: Detection): detection is Extract<Detection, { body: unknown }> {
  return (
    detection.feedType === "tsml" ||
    detection.feedType === "meeting_guide_json" ||
    detection.feedType === "google_sheet"
  );
}

// The discover command (spec §4): crawls every state's directory page, de-duplicates the entities it
// lists, detects and verifies each one's meeting feed, and writes the registry and coverage report.
// Only counts, progress and entity ids are logged - never a restricted feed's URL or any response body.
export async function run(options: RunOptions = {}): Promise<RunResult> {
  const states = options.states ?? US_STATES.map((state) => state.code);
  const directoryUrl = options.directoryUrl ?? DEFAULT_DIRECTORY_URL;
  const outDir = options.outDir ?? TOOL_DIR;
  const registryPath = join(outDir, "registry.yaml");
  const coveragePath = join(outDir, "coverage.md");

  const crawler = createCrawler();

  const previous = await readRegistry(registryPath);

  const entityById = new Map<string, DirectoryEntity>();
  for (const code of states) {
    const result = await crawler.get(`${directoryUrl}?state=${code}`);
    // A missing state page would silently drop every entity it lists (and their registry history), so
    // the whole run fails instead and writes nothing.
    if (result.kind !== "response" || result.status < 200 || result.status >= 300) {
      throw new Error(`${code}: directory page unavailable; nothing was written`);
    }
    const pageEntities = parseDirectoryPage(result.body, code);
    // A page that parses to nothing where entities were listed before is a challenge page or a markup
    // change, not a state whose every office closed; accepting it would drop the whole state.
    if (pageEntities.length === 0 && previous.some((entry) => entry.state === code)) {
      throw new Error(`${code}: directory page lists no entities; nothing was written`);
    }
    console.log(`${code}: ${String(pageEntities.length)} entities`);
    for (const entity of pageEntities) {
      if (!entityById.has(entity.id)) entityById.set(entity.id, entity);
    }
  }
  const entities = [...entityById.values()];

  const detections = new Map<string, { detection: Detection; verification: VerifyResult | null }>();
  const withWebsite = entities.filter(hasWebsite);
  let checked = 0;
  await mapWithConcurrency(withWebsite, CONCURRENCY, async (entity) => {
    const detection = await detectFeed(entity.website, crawler);
    const verification = hasBody(detection) ? verifyFeed(detection.body) : null;
    detections.set(entity.id, { detection, verification });
    checked += 1;
    console.log(`${String(checked)}/${String(withWebsite.length)} checked`);
  });

  const found = entities.map((entity) => {
    const result = detections.get(entity.id);
    if (result !== undefined) return { entity, ...result };
    // No website was listed, so no feed check ran; `entity.notes` already records why.
    return {
      entity,
      detection: { feedType: "none_found" as const, notes: entity.notes },
      verification: null,
    };
  });

  const checkedAt = new Date().toISOString().slice(0, 10);
  const registry = buildRegistry(found, previous, checkedAt);

  const keysByFeed = new Map<string, Set<string>>();
  for (const { entity, verification } of found) {
    if (verification !== null) keysByFeed.set(entity.id, verification.meetingKeys);
  }
  const overlaps = computeOverlaps(keysByFeed);
  const changes = computeChanges(previous, registry);

  await writeRegistry(registryPath, registry);
  await writeFile(coveragePath, renderCoverage(registry, overlaps, changes), "utf-8");

  return {
    entities: registry.length,
    verified: registry.filter((entry) => entry.verified).length,
  };
}

function parseCliOptions(argv: string[]): RunOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      state: { type: "string", multiple: true },
      "directory-url": { type: "string" },
      "out-dir": { type: "string" },
    },
  });
  const states = values.state?.flatMap((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== ""),
  );
  return {
    states: states !== undefined && states.length > 0 ? states : undefined,
    directoryUrl: values["directory-url"],
    outDir: values["out-dir"],
  };
}

// `discover --na` (pnpm discover:na) reads NA's root servers instead of aa.org's directory.
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--na")) {
    const { values } = parseArgs({
      args: argv.filter((arg) => arg !== "--na"),
      options: { "server-list-url": { type: "string" }, "out-dir": { type: "string" } },
    });
    const { servers, meetings } = await runNa({
      serverListUrl: values["server-list-url"],
      outDir: values["out-dir"] ?? TOOL_DIR,
    });
    console.log(`${String(servers)} NA servers, ${String(meetings)} meetings`);
    return;
  }
  const { entities, verified } = await run(parseCliOptions(argv));
  console.log(`${String(entities)} entities, ${String(verified)} verified`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
