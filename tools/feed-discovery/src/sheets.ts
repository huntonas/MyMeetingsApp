// Rewrites a Google Sheet URL (as published from the TSML UI's `data-src`, or linked from a homepage)
// to the code4recovery storage endpoint that actually serves the meeting JSON. Returns null for any
// URL that isn't a Google Sheet.
export function sheetStorageUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "docs.google.com") return null;
  const match = /^\/spreadsheets\/d\/([^/]+)/.exec(parsed.pathname);
  const id = match?.[1];
  if (id === undefined) return null;
  return `https://sheets.code4recovery.org/storage/${id}.json`;
}

// A feed served from code4recovery's Google Sheet storage endpoint is a `google_sheet`; any other
// feed URL is `meeting_guide_json`. Shared by the linked feed (step 3) and the TSML UI's data-src
// sources (step 4), so both classify the same way whether or not the URL went through
// `sheetStorageUrl`'s rewrite.
export function classifyFeedType(url: string): "google_sheet" | "meeting_guide_json" {
  return new URL(url).host === "sheets.code4recovery.org" ? "google_sheet" : "meeting_guide_json";
}
