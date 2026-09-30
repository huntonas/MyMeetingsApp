import { z } from "zod";

// A HAR param: a plain form field, or (fileName/contentType set) a multipart file field — either can carry a
// canary, so both are scanned.
const Param = z.object({
  name: z.string(),
  value: z.string().optional(),
  fileName: z.string().optional(),
  contentType: z.string().optional(),
});

// A HAR body: `text` (the raw or base64-encoded bytes) and/or `params` (a form-encoded body's fields), never
// neither — an empty postData object hides which shape the real request used.
const PostData = z
  .strictObject({
    mimeType: z.string().optional(),
    text: z.string().optional(),
    params: z.array(Param).optional(),
    // Any other encoding is refused rather than silently scanned undecoded (spec §2: fail closed).
    encoding: z.literal("base64").optional(),
  })
  .refine((data) => data.text !== undefined || data.params !== undefined, {
    message: "postData needs text or params",
  });

// mitmdump's savehar.py writes cookies separately from the raw Cookie header text; not strict, since a real
// capture's cookie entries carry other fields (path, expires, ...) this audit doesn't need.
const Cookie = z.object({ name: z.string(), value: z.string() });

// A websocket frame, mitmproxy's HAR extension (sibling to "request" on the entry, not part of it). Not
// strict: a real capture's frames carry other fields (type, time, fromClient, opcode, ...) this audit ignores.
const WebSocketMessage = z.object({ data: z.string() });

// The part of a HAR capture (`mitmdump --set hardump=<file>`) the audit reads.
export const Har = z.object({
  log: z.object({
    entries: z.array(
      z.object({
        request: z.object({
          method: z.string(),
          url: z.string(),
          headers: z.array(z.object({ name: z.string(), value: z.string() })),
          cookies: z.array(Cookie).optional(),
          postData: PostData.optional(),
          // mitmdump always writes this, for every method, even when it doesn't write postData at all.
          bodySize: z.number().optional(),
        }),
        _webSocketMessages: z.array(WebSocketMessage).optional(),
      }),
    ),
  }),
});
export type Har = z.infer<typeof Har>;
