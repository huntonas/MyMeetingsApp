import { z } from "zod";

// Spec §5: a suggested new tag of 2–40 characters after trimming: letters, digits, spaces, apostrophes, hyphens and
// ampersands, starting with a letter or digit, so nothing that could be a link or markup gets in.
export const SuggestionRequest = z.object({
  text: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} '’&-]*$/u),
});
export type SuggestionRequest = z.infer<typeof SuggestionRequest>;

// The screening result isn't shown to the app (nobody can probe the screener); it only confirms receipt.
export const SuggestionResponse = z.object({ status: z.literal("received") });
export type SuggestionResponse = z.infer<typeof SuggestionResponse>;
