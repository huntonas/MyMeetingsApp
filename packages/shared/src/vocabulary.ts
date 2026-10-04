import { z } from "zod";

// The only categories builds before the /api/v2 list (TestFlight build 12 among them) accept: they parse the category
// with this fixed list, so one tag in any other makes them refuse the whole list. /api/v1/vocabulary serves only these.
export const V1_TAG_CATEGORIES = ["format", "sharing", "crowd", "feel", "practical"] as const;

// In display order.
export const TAG_CATEGORIES = ["format", "sharing", "crowd", "size", "feel", "practical"] as const;

type TagCategory = (typeof TAG_CATEGORIES)[number];

export const TagSlug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const TagLabel = z.string().min(1).max(40);

// A category is any slug-shaped name, so an app keeps working when the server adds one it has never heard of: it
// shows the new group under a heading made from the name.
export const VocabularyResponse = z.object({
  tags: z.array(z.object({ slug: TagSlug, label: TagLabel, category: TagSlug })),
});
export type VocabularyResponse = z.infer<typeof VocabularyResponse>;

export const V1VocabularyResponse = z.object({
  tags: z.array(z.object({ slug: TagSlug, label: TagLabel, category: z.enum(V1_TAG_CATEGORIES) })),
});

interface VocabularyTag {
  slug: string;
  label: string;
  category: TagCategory;
}

const tag = (category: TagCategory, slug: string, label: string): VocabularyTag => ({
  slug,
  label,
  category,
});

// Spec §5 vocabulary, in display order. `pnpm --filter web db:seed` writes it to a database.
export const STARTER_VOCABULARY: readonly VocabularyTag[] = [
  tag("format", "by-the-book", "By the book"),
  tag("format", "laid-back", "Laid back"),
  tag("format", "speaker-heavy", "Speaker-heavy"),
  tag("format", "lots-of-sharing", "Lots of sharing"),
  tag("format", "step-study", "Step study"),
  tag("format", "literature-focused", "Literature focused"),
  tag("format", "check-in", "Check-in"),
  tag("sharing", "crosstalk", "Crosstalk"),
  tag("sharing", "no-crosstalk", "No crosstalk"),
  tag("sharing", "round-robin", "Round robin"),
  tag("sharing", "raise-your-hand", "Raise your hand"),
  tag("sharing", "timed-shares", "Timed shares"),
  tag("crowd", "newcomer-heavy", "Newcomer heavy"),
  tag("crowd", "old-timers", "Old-timers"),
  tag("crowd", "young-crowd", "Young crowd"),
  tag("crowd", "older-crowd", "Older crowd"),
  tag("crowd", "mixed-ages", "Mixed ages"),
  tag("size", "size-small", "Small (under 15)"),
  tag("size", "size-medium", "Medium (15–30)"),
  tag("size", "size-large", "Large (30–100)"),
  tag("size", "size-very-large", "Very large (100+)"),
  tag("feel", "welcoming", "Welcoming"),
  tag("feel", "good-for-newcomers", "Good for newcomers"),
  tag("feel", "quiet", "Quiet"),
  tag("feel", "lively", "Lively"),
  tag("feel", "lots-of-humor", "Lots of humor"),
  tag("feel", "serious-tone", "Serious tone"),
  tag("practical", "starts-on-time", "Starts on time"),
  tag("practical", "runs-long", "Runs long"),
  tag("practical", "coffee", "Coffee"),
  tag("practical", "snacks", "Snacks"),
  tag("practical", "fellowship-after", "Fellowship after"),
  tag("practical", "easy-parking", "Easy parking"),
  tag("practical", "accessible-entrance", "Accessible entrance"),
  tag("practical", "kids-welcome", "Kids welcome"),
];
