import { eq } from "drizzle-orm";
import type { RegistryEntry } from "@mymeetingapp/feed-kit";

import { db } from "@/db/client";
import { feeds } from "@/db/schema";
import { DEFAULT_PRIORITY, upsertFeed } from "@/db/upsert-feed";

type SeedableEntry = RegistryEntry & { feed_url: string };

// The Phase 2 feeds table only understands these three feed shapes; bmlt and none_found/restricted
// entries have no consumer yet.
function isSeedable(entry: RegistryEntry): entry is SeedableEntry {
  return (
    entry.verified &&
    entry.feed_url !== null &&
    (entry.feed_type === "tsml" ||
      entry.feed_type === "meeting_guide_json" ||
      entry.feed_type === "google_sheet")
  );
}

// Two registry entries can share one feed_url (e.g. an intergroup and its answering service on the
// same site). feeds.url is unique, so only the entity with the lower default priority is seeded;
// ties break by id.
function pickWinner(group: SeedableEntry[]): SeedableEntry {
  return group.reduce((best, entry) => {
    const entryPriority = DEFAULT_PRIORITY[entry.entity_type];
    const bestPriority = DEFAULT_PRIORITY[best.entity_type];
    if (entryPriority < bestPriority) return entry;
    if (entryPriority === bestPriority && entry.id < best.id) return entry;
    return best;
  });
}

export interface SeedFeedsResult {
  upserted: number;
  optedOut: number;
  skipped: number;
}

// Loads the discovery registry's verified feeds into the feeds table (spec §4). Not every registry
// entry becomes a feed: unverified, un-fed, restricted or bmlt/none_found entries are skipped, and a
// feed_url shared by two entries seeds only the lower-priority one.
export async function seedFeedsFromRegistry(entries: RegistryEntry[]): Promise<SeedFeedsResult> {
  const seedable = entries.filter(isSeedable);

  const byUrl = new Map<string, SeedableEntry[]>();
  for (const entry of seedable) {
    byUrl.set(entry.feed_url, [...(byUrl.get(entry.feed_url) ?? []), entry]);
  }

  let upserted = 0;
  let optedOut = 0;
  let skipped = entries.length - seedable.length;

  for (const group of byUrl.values()) {
    skipped += group.length - 1;
    const winner = pickWinner(group);

    await upsertFeed({
      slug: winner.id,
      name: winner.name,
      entityType: winner.entity_type,
      state: winner.state,
      url: winner.feed_url,
    });
    upserted += 1;

    if (winner.opted_out === true) {
      await db.update(feeds).set({ optedOut: true }).where(eq(feeds.slug, winner.id));
      optedOut += 1;
    }
  }

  return { upserted, optedOut, skipped };
}
