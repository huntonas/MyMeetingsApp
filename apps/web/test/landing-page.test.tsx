import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage, { metadata } from "@/app/(site)/page";
import { SITE_DESCRIPTION } from "@/lib/page-metadata";

import { renderText } from "./render";

// Owner decision, 2026-10-06: until launch, the home page says only that the app is coming soon. The privacy policy,
// terms and support page stay, since the App Store listing links to them.
describe("the home page", () => {
  it("says the app is coming soon", () => {
    const text = renderText(<HomePage />);
    expect(text).toContain("My Meeting App");
    expect(text).toContain("Coming soon.");
  });

  it("carries no marketing: no screenshots, store badge, features or structured data", () => {
    const html = renderToStaticMarkup(<HomePage />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("application/ld+json");
    const text = renderText(<HomePage />);
    for (const words of ["App Store", "Descriptions, not ratings", "Private by design", "Also in the app"]) {
      expect(text).not.toContain(words);
    }
  });

  it("is the canonical home page, titled coming soon", () => {
    expect(metadata.title).toBe("Coming soon · My Meeting App");
    expect(metadata.description).toBe(SITE_DESCRIPTION);
    expect(metadata.alternates?.canonical).toBe("/");
  });

  it("still lists crisis help", () => {
    const text = renderText(<HomePage />);
    for (const words of [
      "988 Suicide & Crisis Lifeline",
      "call or text 988",
      "SAMHSA National Helpline",
      "1-800-662-4357",
      "Alcoholics Anonymous has its own meeting finder at aa.org",
      "Narcotics Anonymous has its own meeting finder at na.org",
    ]) {
      expect(text).toContain(words);
    }
    const html = renderToStaticMarkup(<HomePage />);
    for (const href of [
      "tel:988",
      "tel:18006624357",
      "https://www.aa.org/find-aa",
      "https://na.org/meetingsearch/",
    ]) {
      expect(html).toContain(`href="${href}"`);
    }
  });
});
