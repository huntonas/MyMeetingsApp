import { z } from "zod";

// A HAR body: `text` (the raw or base64-encoded bytes) and/or `params` (a form-encoded body's fields), never
// neither — an empty postData object hides which shape the real request used.
const PostData = z
  .strictObject({
    mimeType: z.string().optional(),
    text: z.string().optional(),
    params: z.array(z.object({ name: z.string(), value: z.string().optional() })).optional(),
    // Any other encoding is refused rather than silently scanned undecoded (spec §2: fail closed).
    encoding: z.literal("base64").optional(),
  })
  .refine((data) => data.text !== undefined || data.params !== undefined, {
    message: "postData needs text or params",
  });

// The part of a HAR capture (`mitmdump --set hardump=<file>`) the audit reads.
export const Har = z.object({
  log: z.object({
    entries: z.array(
      z.object({
        request: z.object({
          method: z.string(),
          url: z.string(),
          headers: z.array(z.object({ name: z.string(), value: z.string() })),
          postData: PostData.optional(),
        }),
      }),
    ),
  }),
});
export type Har = z.infer<typeof Har>;
