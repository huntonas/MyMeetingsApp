import { and, eq, ne, sql } from "drizzle-orm";
import type { RegistryEntry } from "@mymeetingapp/feed-kit";

import { db } from "@/db/client";
import { feeds } from "@/db/schema";
import { DEFAULT_PRIORITY, upsertFeed } from "@/db/upsert-feed";

type SeedableEntry = RegistryEntry & { feed_url: string };

// The feeds table reads these feed shapes (Meeting Guide JSON and BMLT); none_found entries have no consumer. A restricted entry with a feed_url is a 12 Step Meeting List feed whose office hasn't given us a key: it's
// seeded waiting for permission, so every feed we want is listed in one place.
function isSeedable(entry: RegistryEntry): entry is SeedableEntry {
  if (entry.feed_url === null) return false;
  if (entry.feed_type === "restricted") return true;
  return (
    entry.verified &&
    (entry.feed_type === "tsml" ||
      entry.feed_type === "meeting_guide_json" ||
      entry.feed_type === "google_sheet" ||
      entry.feed_type === "bmlt")
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

// Loads the discovery registry's verified feeds into the feeds table (spec §4), all in one transaction
// so a failure part-way leaves the table as it was. Not every registry entry becomes a feed: unverified,
// un-fed or bmlt/none_found entries are skipped, and a feed_url shared by several entries
// seeds only the lower-priority one, opted out if any of them is.
export async function seedFeedsFromRegistry(entries: RegistryEntry[]): Promise<SeedFeedsResult> {
  const seedable = entries.filter(isSeedable);

  const byUrl = new Map<string, SeedableEntry[]>();
  for (const entry of seedable) {
    byUrl.set(entry.feed_url, [...(byUrl.get(entry.feed_url) ?? []), entry]);
  }

  let upserted = 0;
  let optedOut = 0;
  let skipped = entries.length - seedable.length;

  const groups = [...byUrl.values()].map((group) => ({ group, winner: pickWinner(group) }));

  await db.transaction(async (tx) => {
    // A winning id can still be held by a row at another url (the entity moved its feed, or two entities
    // swapped urls). feeds.slug is unique, so every such row gives its slug up first: a row whose url is
    // still seeded takes its new winner's slug below, and one whose url is gone keeps a retired slug.
    for (const { winner } of groups) {
      await tx
        .update(feeds)
        .set({ slug: sql`${feeds.slug} || '-retired-' || ${feeds.id}` })
        .where(and(eq(feeds.slug, winner.id), ne(feeds.url, winner.feed_url)));
    }

    for (const { group, winner } of groups) {
      skipped += group.length - 1;
      const groupOptedOut = group.some((entry) => entry.opted_out === true);

      // The winner can differ from the entity that owned this URL on a previous seed (a renamed entity,
      // or a new tie-break winner). feeds.url is unique, so the existing row takes the winner's slug and
      // keeps its sync history, rather than a second row being inserted for the same URL.
      await tx
        .update(feeds)
        .set({ slug: winner.id })
        .where(and(eq(feeds.url, winner.feed_url), ne(feeds.slug, winner.id)));

      await upsertFeed(
        {
          slug: winner.id,
          name: winner.name,
          entityType: winner.entity_type,
          state: winner.state,
          url: winner.feed_url,
          optedOut: groupOptedOut,
          fellowship: winner.fellowship ?? "aa",
          format: winner.feed_type === "bmlt" ? "bmlt" : "meeting_guide",
          ...(winner.feed_type === "restricted" && { waitingReason: "restricted" }),
        },
        tx,
      );
      upserted += 1;
      if (groupOptedOut) optedOut += 1;
    }
  });

  return { upserted, optedOut, skipped };
}
