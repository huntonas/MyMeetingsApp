import { join } from "node:path";

import { bmltEntry, SERVER_LIST_URL, ServerList } from "./bmlt";
import { createCrawler } from "./crawler";
import { readRegistry, writeRegistry } from "./registry-file";

export interface NaRunOptions {
  serverListUrl?: string;
  outDir: string;
}

// The discover:na command (NA design, §1): every U.S. NA root server as one registry entry. Entries of other
// fellowships are kept as they are; a previous NA entry's opt-out carries over, and one the list no longer has is
// dropped unless it's opted out. Only counts are logged, never a response body.
export async function runNa(options: NaRunOptions): Promise<{ servers: number; meetings: number }> {
  const registryPath = join(options.outDir, "registry.yaml");
  const previous = await readRegistry(registryPath);
  const crawler = createCrawler();
  const list = await crawler.get(options.serverListUrl ?? SERVER_LIST_URL);
  if (list.kind !== "response" || list.status !== 200) throw new Error("couldn't read the BMLT server list");

  const checkedAt = new Date().toISOString().slice(0, 10);
  const found = [];
  for (const server of ServerList.parse(JSON.parse(list.body))) {
    const entry = await bmltEntry(server, crawler, checkedAt);
    if (entry !== null) found.push(entry);
  }

  const optedOut = new Set(previous.filter((entry) => entry.opted_out === true).map((entry) => entry.id));
  const foundIds = new Set(found.map((entry) => entry.id));
  await writeRegistry(registryPath, [
    ...previous.filter((entry) => entry.fellowship !== "na"),
    ...found.map((entry) => (optedOut.has(entry.id) ? { ...entry, opted_out: true } : entry)),
    ...previous.filter(
      (entry) => entry.fellowship === "na" && entry.opted_out === true && !foundIds.has(entry.id),
    ),
  ]);
  return { servers: found.length, meetings: found.reduce((sum, entry) => sum + entry.meeting_count, 0) };
}
