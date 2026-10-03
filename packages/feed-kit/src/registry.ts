import { parse } from "yaml";
import { z } from "zod";

const FEED_TYPES = [
  "tsml",
  "meeting_guide_json",
  "google_sheet",
  "bmlt",
  "none_found",
  "restricted",
  "bot_blocked",
] as const;
const REGISTRY_ENTITY_TYPES = ["area", "district", "intergroup", "central_office"] as const;

const WebUrl = z.url({ protocol: /^https?$/ });

// One line of tools/feed-discovery/registry.yaml (spec §4). Keys stay snake_case to match the spec's YAML.
export const RegistryEntry = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  entity_type: z.enum(REGISTRY_ENTITY_TYPES),
  state: z.string().regex(/^[A-Z]{2}$/),
  website: WebUrl.nullable(),
  feed_type: z.enum(FEED_TYPES),
  feed_url: WebUrl.nullable(),
  verified: z.boolean(),
  meeting_count: z.number().int().min(0),
  states_covered: z.array(z.string().regex(/^[A-Z]{2}$/)),
  // "City, ST" for every US city the feed lists a meeting in, so coverage is known without re-crawling.
  cities_covered: z.array(z.string().min(1)),
  checked_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string(),
  opted_out: z.boolean().optional(),
});
export type RegistryEntry = z.infer<typeof RegistryEntry>;

function entryLabel(entry: unknown, index: number): string {
  return typeof entry === "object" && entry !== null && "id" in entry && typeof entry.id === "string"
    ? `"${entry.id}"`
    : `entry ${String(index)}`;
}

// The one reader for registry.yaml's contents, shared by the discovery tool and the seed script. A
// document that isn't a list, or any invalid entry, throws, naming the entry by id (or by position when
// it has no id), so a hand-edit mistake can't silently drop or seed the wrong feeds.
export function parseRegistry(raw: string): RegistryEntry[] {
  const parsed: unknown = parse(raw);
  if (!Array.isArray(parsed)) throw new Error("registry must be a YAML list");
  return parsed.map((entry: unknown, index) => {
    const result = RegistryEntry.safeParse(entry);
    if (!result.success) {
      throw new Error(`Invalid registry entry ${entryLabel(entry, index)}: ${result.error.message}`);
    }
    return result.data;
  });
}
