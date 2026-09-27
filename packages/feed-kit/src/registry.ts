import { z } from "zod";

const FEED_TYPES = [
  "tsml",
  "meeting_guide_json",
  "google_sheet",
  "bmlt",
  "none_found",
  "restricted",
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
  checked_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string(),
  opted_out: z.boolean().optional(),
});
export type RegistryEntry = z.infer<typeof RegistryEntry>;
