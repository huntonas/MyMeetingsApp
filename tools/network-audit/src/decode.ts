// Every way a canary or coordinate fragment can hide in one piece of text (a URL, a header value, a body, a
// HAR param), so the audit can still find it underneath whatever encoding carried it.

function decodeUtf8PercentRun(run: string): string {
  const bytes = run.match(/%[0-9a-f]{2}/gi)?.map((hex) => parseInt(hex.slice(1), 16)) ?? [];
  return Buffer.from(bytes).toString("utf8");
}

// Decodes each contiguous run of %XX bytes together, as UTF-8 — not one code point at a time — so a
// multi-byte sequence like %C3%A9 ("é") decodes correctly instead of turning into two unrelated characters.
// Never throws, unlike decodeURIComponent: an invalid %zz run elsewhere is left untouched instead of aborting
// the whole decode, so a validly encoded canary next to it is still found.
function percentDecodedOnce(text: string): string {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, decodeUtf8PercentRun);
}

// Some encoders percent-encode their own output (a literal "%" becomes "%25"). Decoding once only peels off
// the outer layer, so repeat until the text stops changing, capped so a pathological input can't loop forever.
function percentDecodedRepeated(text: string): string {
  let current = text;
  for (let pass = 0; pass < 3; pass++) {
    const next = percentDecodedOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(parseInt(dec, 10)));
}

function jsonRoundTrip(text: string): string | undefined {
  try {
    // JSON.parse un-escapes \uXXXX; re-serializing a plain-text result doesn't re-escape it, so a canary
    // hidden behind a unicode escape shows up in the stringified output as plain text.
    return JSON.stringify(JSON.parse(text));
  } catch {
    return undefined;
  }
}

// Every view of one piece of text worth scanning: as written; percent-decoded (repeatedly, as UTF-8); with a
// form-encoded "+" turned into a space and then percent-decoded; with HTML/XML numeric entities decoded; and
// (for JSON, tried on both the raw and the percent-decoded text) unescaped by a parse/stringify round trip.
export function views(raw: string): string[] {
  const percentDecoded = percentDecodedRepeated(raw);
  const plusThenPercent = percentDecodedRepeated(raw.replace(/\+/g, " "));
  const entityDecoded = decodeEntities(raw);
  const result = new Set([raw, percentDecoded, plusThenPercent, entityDecoded]);
  for (const candidate of [raw, percentDecoded]) {
    const json = jsonRoundTrip(candidate);
    if (json !== undefined) result.add(json);
  }
  return [...result];
}
