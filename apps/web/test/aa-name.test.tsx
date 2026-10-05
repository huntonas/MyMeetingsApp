import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import HomePage, { metadata as homeMetadata } from "@/app/(site)/page";
import PrivacyPage from "@/app/(site)/privacy/page";
import SupportPage from "@/app/(site)/support/page";
import TermsPage from "@/app/(site)/terms/page";
import { SITE_DESCRIPTION } from "@/lib/page-metadata";

import { renderText } from "./render";

// Owner decision, 2026-10-05: the site says "recovery meetings", not "AA meetings". The AA name is AA World
// Services' mark and the Sixth Tradition keeps AA from lending it to an outside enterprise, so AA is named only to
// say we aren't affiliated, and to send people to AA's own meeting finder (HelpResources).
const DISCLAIMERS = [
  "Not affiliated with Alcoholics Anonymous or Narcotics Anonymous",
  "not affiliated with, endorsed by or approved by Alcoholics Anonymous, A.A. World Services, Inc., Narcotics Anonymous or NA World Services, Inc.",
  "Alcoholics Anonymous has its own meeting finder at aa.org",
  "Narcotics Anonymous has its own meeting finder at na.org",
  "AA and NA meetings",
  // Where listings come from.
  "NA region",
];
const NAMES = /\bA\.?A\b|Alcoholics Anonymous|\bN\.?A\b|Narcotics Anonymous/;

function withoutDisclaimers(text: string): string {
  return DISCLAIMERS.reduce((rest, disclaimer) => rest.replaceAll(disclaimer, ""), text);
}

describe("the AA and NA names on the website", () => {
  it.each<[string, () => ReactElement]>([
    ["home", () => <HomePage />],
    ["privacy", () => <PrivacyPage />],
    ["support", () => <SupportPage />],
    ["terms", () => <TermsPage />],
  ])("appears on the %s page only in the disclaimers, the finders and the sources", (_page, page) => {
    expect(withoutDisclaimers(renderText(page()))).not.toMatch(NAMES);
  });

  it("stays out of the site's description and the home page's title", () => {
    expect(SITE_DESCRIPTION).not.toMatch(NAMES);
    expect(JSON.stringify(homeMetadata)).not.toMatch(NAMES);
  });
});
