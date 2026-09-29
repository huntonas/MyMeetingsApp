import { z } from "zod";

import { TagSlug } from "./vocabulary";

// Spec §5: tags show as a flat list with counts, already sorted by the server.
export const TagCount = z.object({ slug: TagSlug, count: z.number().int().positive() });
export type TagCount = z.infer<typeof TagCount>;

export const MAX_TAGS_PER_SUBMISSION = 6;

// Spec §5: 1 to MAX_TAGS_PER_SUBMISSION distinct tags. The server answers a longer list with too_many_tags, so the
// schema only caps its size.
const TagList = z
  .array(TagSlug)
  .min(1)
  .max(50)
  .refine((slugs) => new Set(slugs).size === slugs.length, "List each tag once");

export const TagSubmissionRequest = z.object({
  meetingId: z.uuid(),
  tags: TagList,
  nearMeeting: z.boolean().optional(),
});
export type TagSubmissionRequest = z.infer<typeof TagSubmissionRequest>;

export const TagEditRequest = z.object({ tags: TagList });
export type TagEditRequest = z.infer<typeof TagEditRequest>;

// meetingId is the meeting the tags landed on: the one requested, or the meeting it merged into.
export const TagWriteResponse = z.object({ meetingId: z.uuid(), tags: z.array(TagCount) });
export type TagWriteResponse = z.infer<typeof TagWriteResponse>;
