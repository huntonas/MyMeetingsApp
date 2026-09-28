import { describe, expect, it } from "vitest";

import { classifyFeedType, sheetStorageUrl } from "../src/sheets";

describe("sheetStorageUrl", () => {
  it("rewrites a Google Sheet edit URL to its code4recovery storage URL", () => {
    expect(sheetStorageUrl("https://docs.google.com/spreadsheets/d/1AbCdEf23/edit#gid=0")).toBe(
      "https://sheets.code4recovery.org/storage/1AbCdEf23.json",
    );
  });

  it("returns null for a URL that isn't a Google Sheet", () => {
    expect(sheetStorageUrl("https://example.org/feed.json")).toBeNull();
  });
});

describe("classifyFeedType", () => {
  it("classifies a code4recovery storage URL as a google sheet feed", () => {
    expect(classifyFeedType("https://sheets.code4recovery.org/storage/1AbCdEf23.json")).toBe("google_sheet");
  });

  it("classifies any other feed URL as meeting_guide_json", () => {
    expect(classifyFeedType("https://example.org/feed.json")).toBe("meeting_guide_json");
  });
});
