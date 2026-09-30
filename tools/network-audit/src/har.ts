import { z } from "zod";

// The part of a HAR capture (`mitmdump --set hardump=<file>`) the audit reads.
export const Har = z.object({
  log: z.object({
    entries: z.array(
      z.object({
        request: z.object({
          method: z.string(),
          url: z.string(),
          headers: z.array(z.object({ name: z.string(), value: z.string() })),
          postData: z.object({ text: z.string().optional() }).optional(),
        }),
      }),
    ),
  }),
});
export type Har = z.infer<typeof Har>;
