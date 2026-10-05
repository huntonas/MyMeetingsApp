import { readFileSync } from "node:fs";
import path from "node:path";

import { BRAND } from "@mymeetingapp/shared";
import { z } from "zod";

import appConfig from "../app.config";
import { describesTheAppAsItIs } from "./listing-claims";

const read = (file: string): unknown => JSON.parse(readFileSync(path.join(__dirname, "..", file), "utf8"));

const Listing = z.object({
  configVersion: z.literal(0),
  apple: z.object({
    version: z.string(),
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

  it("carries spec §11's keywords, none of them AA", () => {
    expect(english().keywords).toEqual(
      expect.arrayContaining(["support group", "meeting finder", "sobriety counter"]),
    );
    expect(english().keywords.join(",")).not.toMatch(/\baa\b/i);
  });

  it("links the privacy policy and support pages on the site the store build uses (spec §11)", () => {
    const site = productionSite();
    expect(english()).toMatchObject({
      marketingUrl: site,
      supportUrl: `${site}/support`,
      privacyPolicyUrl: `${site}/privacy`,
    });
  });

  describesTheAppAsItIs(() => english().description);

  it("names only Apple's stores and maps", () => {
    expect(english().description).not.toMatch(/Android|Google/);
  });

  it("names the publisher and is released by hand, after the seller check (owner decision needed 1)", () => {
    expect(listing().copyright).toBe(`2026 ${BRAND.publisher}`);
    expect(listing().release).toEqual({ automaticRelease: false });
  });

  // App Store Connect names the version the listing is pushed to, and the build attached to it must carry the same.
  it("is pushed to the version the app builds as", () => {
    const context = {
      projectRoot: path.join(__dirname, ".."),
      staticConfigPath: null,
      packageJsonPath: null,
      config: {},
    };
    expect(listing().version).toBe(z.object({ version: z.string() }).parse(appConfig(context)).version);
  });
});
