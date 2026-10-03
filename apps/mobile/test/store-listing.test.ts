import { readFileSync } from "node:fs";
import path from "node:path";

import { BRAND } from "@mymeetingapp/shared";
import { z } from "zod";

import { WIDER_SEARCH_RADIUS_KM } from "@/location/geo";
import { radiusMiles } from "@/meetings/units";

const read = (file: string): unknown => JSON.parse(readFileSync(path.join(__dirname, "..", file), "utf8"));

const Listing = z.object({
  configVersion: z.literal(0),
  apple: z.object({
    copyright: z.string(),
    categories: z.array(z.string()),
    release: z.object({ automaticRelease: z.boolean() }),
    info: z.object({
      "en-US": z.object({
        title: z.string(),
        subtitle: z.string(),
        promoText: z.string(),
        description: z.string(),
        keywords: z.array(z.string()),
        marketingUrl: z.string(),
        supportUrl: z.string(),
        privacyPolicyUrl: z.string(),
      }),
    }),
  }),
});
const listing = () => Listing.parse(read("store.config.json")).apple;
const english = () => listing().info["en-US"];
// The site the store build talks to (eas.json's production profile): the listing links the same pages the app's Me
// tab opens there.
const productionSite = () =>
  z
    .object({
      build: z.object({ production: z.object({ env: z.object({ EXPO_PUBLIC_SERVER_URL: z.string() }) }) }),
    })
    .parse(read("eas.json")).build.production.env.EXPO_PUBLIC_SERVER_URL;

describe("the App Store listing", () => {
  it("fits App Store Connect's limits", () => {
    const info = english();
    expect(info.title.length).toBeLessThanOrEqual(30);
    expect(info.subtitle.length).toBeLessThanOrEqual(30);
    expect(info.promoText.length).toBeLessThanOrEqual(170);
    expect(info.description.length).toBeLessThanOrEqual(4000);
    expect(info.keywords.join(",").length).toBeLessThanOrEqual(100);
  });

  it("starts the name with the app's name and keeps 'AA' out of it (spec §11)", () => {
    expect(english().title.startsWith(BRAND.name)).toBe(true);
    expect(english().title).not.toMatch(/\bAA\b/i);
  });

  it("carries spec §11's keywords", () => {
    expect(english().keywords).toEqual(
      expect.arrayContaining(["aa meetings", "meeting finder", "sobriety counter"]),
    );
  });

  it("links the privacy policy and support pages on the site the store build uses (spec §11)", () => {
    const site = productionSite();
    expect(english()).toMatchObject({
      marketingUrl: site,
      supportUrl: `${site}/support`,
      privacyPolicyUrl: `${site}/privacy`,
    });
  });

  it("says it isn't AA's, isn't medical advice, and where help is", () => {
    const { description } = english();
    expect(description).toContain(
      "not affiliated with or endorsed by Alcoholics Anonymous or A.A. World Services, Inc.",
    );
    expect(description).toContain("The app isn't medical advice.");
    expect(description).toContain("the 988 Suicide & Crisis Lifeline and the SAMHSA National Helpline");
  });

  // Nearby's "Search farther" goes as far as WIDER_SEARCH_RADIUS_KM, which the app shows as whole miles.
  it("says how far Search farther goes, as the app does", () => {
    expect(english().description).toContain(
      `- If nothing is close by, search farther, up to ${String(radiusMiles(WIDER_SEARCH_RADIUS_KM))} miles.`,
    );
  });

  it("names the publisher and is released by hand, after the seller check (owner decision needed 1)", () => {
    expect(listing().copyright).toBe(`2026 ${BRAND.publisher}`);
    expect(listing().release).toEqual({ automaticRelease: false });
  });
});
