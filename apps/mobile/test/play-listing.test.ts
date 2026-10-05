import { readFileSync } from "node:fs";
import path from "node:path";

import { BRAND } from "@mymeetingapp/shared";
import { z } from "zod";

import { describesTheAppAsItIs } from "./listing-claims";

// Entered by hand in the Play Console (docs/google-play.md): nothing pushes it.
const listing = () =>
  z
    .object({
      language: z.literal("en-US"),
      title: z.string(),
      shortDescription: z.string(),
      fullDescription: z.string(),
    })
    .strict()
    .parse(
      JSON.parse(readFileSync(path.join(__dirname, "..", "store", "google-play", "listing.json"), "utf8")),
    );

describe("the Google Play listing", () => {
  it("fits the Play Console's limits", () => {
    const { title, shortDescription, fullDescription } = listing();
    expect(title.length).toBeLessThanOrEqual(30);
    expect(shortDescription.length).toBeLessThanOrEqual(80);
    expect(fullDescription.length).toBeLessThanOrEqual(4000);
  });

  it("starts the title with the app's name and keeps 'AA' out of the title and short description (spec §11)", () => {
    const { title, shortDescription } = listing();
    expect(title.startsWith(BRAND.name)).toBe(true);
    expect(`${title} ${shortDescription}`).not.toMatch(/\bAA\b/i);
  });

  // Play's metadata policy: no emoji, shouting or ranking, price and promotional words in the title or short
  // description.
  it("keeps the title and short description plain", () => {
    const { title, shortDescription } = listing();
    for (const text of [title, shortDescription]) {
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(text).not.toMatch(/\b[A-Z]{3,}\b/);
      expect(text).not.toMatch(/\b(free|best|top|new|sale|download|install)\b|#1/i);
    }
  });

  // Play shows the description as written: no HTML or Markdown, which would show as raw characters.
  it("writes the full description as plain text", () => {
    const { fullDescription } = listing();
    expect(fullDescription).not.toMatch(/<[a-z/]|\*|^#|\[[^\]]*\]\(/im);
    expect(fullDescription).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  describesTheAppAsItIs(() => listing().fullDescription);

  it("names only Android's stores and maps", () => {
    expect(listing().fullDescription).not.toMatch(/Apple|iPhone|iOS|App Store/);
  });
});
