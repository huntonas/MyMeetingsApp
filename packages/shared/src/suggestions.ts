import { z } from "zod";

// Spec §5: a tag's words, 2–40 characters after trimming: letters, digits, spaces, apostrophes, hyphens and
// ampersands, starting with a letter or digit, so nothing that could be a link or markup gets in. A suggestion and a
// label the admin approves both use it.
export const TagLabelText = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} '’&-]*$/u);

export const SuggestionRequest = z.object({ text: TagLabelText });
export type SuggestionRequest = z.infer<typeof SuggestionRequest>;

// The screening result isn't shown to the app (nobody can probe the screener); it only confirms receipt.
export const SuggestionResponse = z.object({ status: z.literal("received") });
export type SuggestionResponse = z.infer<typeof SuggestionResponse>;
