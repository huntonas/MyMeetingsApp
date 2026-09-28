const MAX_BYTES = 50 * 1024 * 1024;

// Spec §4 politeness: a response body is never fully buffered when it's oversized. Checks the declared
// Content-Length up front, then counts bytes as they arrive (whatever the declared length claimed), so a
// mid-stream lie about size still can't exhaust memory.
export async function readBodyCapped(response: Response): Promise<string | null> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) {
    // Release the connection instead of leaving the unread body streaming.
    await response.body?.cancel();
    return null;
  }
  if (response.body === null) return "";
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
