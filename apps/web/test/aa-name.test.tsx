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
  "Not affiliated with Alcoholics Anonymous",
  "not affiliated with, endorsed by or approved by Alcoholics Anonymous or A.A. World Services, Inc.",
  "Alcoholics Anonymous has its own meeting finder at aa.org",
  "Narcotics Anonymous has its own meeting finder at na.org",
];
const AA_NAME = /\bA\.?A\b|Alcoholics Anonymous/;

function withoutDisclaimers(text: string): string {
  return DISCLAIMERS.reduce((rest, disclaimer) => rest.replaceAll(disclaimer, ""), text);
}

describe("the AA name on the website", () => {
  it.each<[string, () => ReactElement]>([
    ["home", () => <HomePage />],
    ["privacy", () => <PrivacyPage />],
    ["support", () => <SupportPage />],
    ["terms", () => <TermsPage />],
  ])("appears on the %s page only in the disclaimer and the pointer to AA's finder", (_page, page) => {
    expect(withoutDisclaimers(renderText(page()))).not.toMatch(AA_NAME);
  });

  it("stays out of the site's description and the home page's title", () => {
    expect(SITE_DESCRIPTION).not.toMatch(AA_NAME);
    expect(JSON.stringify(homeMetadata)).not.toMatch(AA_NAME);
  });
});
