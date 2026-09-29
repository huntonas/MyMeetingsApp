import { z } from "zod";

export const TAG_CATEGORIES = ["format", "sharing", "crowd", "feel", "practical"] as const;

const TagCategory = z.enum(TAG_CATEGORIES);
type TagCategory = z.infer<typeof TagCategory>;

export const TagSlug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const VocabularyTag = z.object({
  slug: TagSlug,
  label: z.string().min(1).max(40),
  category: TagCategory,
});
type VocabularyTag = z.infer<typeof VocabularyTag>;

export const VocabularyResponse = z.object({ tags: z.array(VocabularyTag) });
export type VocabularyResponse = z.infer<typeof VocabularyResponse>;

const tag = (category: TagCategory, slug: string, label: string): VocabularyTag => ({
  slug,
  label,
  category,
});

// Spec §5 starter vocabulary, in display order.
export const STARTER_VOCABULARY: readonly VocabularyTag[] = [
  tag("format", "by-the-book", "By the book"),
  tag("format", "laid-back", "Laid back"),
  tag("format", "speaker-heavy", "Speaker-heavy"),
  tag("format", "lots-of-sharing", "Lots of sharing"),
  tag("format", "step-study", "Step study"),
  tag("format", "literature-focused", "Literature focused"),
  tag("sharing", "crosstalk", "Crosstalk"),
  tag("sharing", "no-crosstalk", "No crosstalk"),
  tag("sharing", "round-robin", "Round robin"),
  tag("sharing", "raise-your-hand", "Raise your hand"),
  tag("crowd", "newcomer-heavy", "Newcomer heavy"),
  tag("crowd", "old-timers", "Old-timers"),
  tag("crowd", "young-crowd", "Young crowd"),
  tag("crowd", "older-crowd", "Older crowd"),
  tag("crowd", "mixed-ages", "Mixed ages"),
  tag("feel", "welcoming", "Welcoming"),
  tag("feel", "quiet", "Quiet"),
  tag("feel", "lively", "Lively"),
  tag("feel", "lots-of-humor", "Lots of humor"),
  tag("feel", "serious-tone", "Serious tone"),
  tag("practical", "starts-on-time", "Starts on time"),
  tag("practical", "runs-long", "Runs long"),
  tag("practical", "coffee", "Coffee"),
  tag("practical", "fellowship-after", "Fellowship after"),
  tag("practical", "easy-parking", "Easy parking"),
  tag("practical", "accessible-entrance", "Accessible entrance"),
];
