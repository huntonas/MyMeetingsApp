import { z } from "zod";

import { TagSlug } from "./vocabulary";

// Spec §5: tags show as a flat list with counts, already sorted by the server.
export const TagCount = z.object({ slug: TagSlug, count: z.number().int().positive() });
export type TagCount = z.infer<typeof TagCount>;
