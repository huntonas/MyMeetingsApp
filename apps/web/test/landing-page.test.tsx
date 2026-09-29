import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage, { metadata } from "@/app/(site)/page";

import { renderText } from "./render";

describe("the landing page", () => {
  it("leads with the privacy promise, before explaining the tags", () => {
    const text = renderText(<HomePage />);
    const promise = text.indexOf("No account.");
    expect(promise).toBeGreaterThan(-1);
    expect(promise).toBeLessThan(text.indexOf("Descriptions, not ratings"));
    expect(text).toContain("Your exact location stays on your phone.");
    expect(text).toContain("No ads, no tracking, no analytics and no cookies,");
  });

  it("is the canonical home page", () => {
    expect(metadata).toMatchObject({ alternates: { canonical: "/" }, openGraph: { url: "/" } });
  });
});

describe("the landing page's content", () => {
  it("shows an example meeting described with attendees' words and counts", () => {
    const text = renderText(<HomePage />);
    expect(text).toContain("Welcoming 14");
    expect(text).toContain("Laid back 9");
    expect(text).toContain("Coffee 7");
  });

  it("shows both stores as coming soon, with no store links yet", () => {
    const text = renderText(<HomePage />);
    expect(text).toContain("App Store coming soon");
    expect(text).toContain("Google Play coming soon");
    expect(renderToStaticMarkup(<HomePage />)).not.toMatch(/apps\.apple\.com|play\.google\.com/);
  });

  it("marks the store badges as plain text, not as disabled controls", () => {
    expect(renderToStaticMarkup(<HomePage />)).not.toContain("aria-disabled");
  });

  it("says what the tags leave out, without claiming nobody can be singled out", () => {
    const text = renderText(<HomePage />);
    expect(text).toContain(
      "There are no stars, scores or written reviews, so nothing ranks one meeting against another, and tags never describe people.",
    );
    expect(text).not.toContain("single out");
  });

  it("keeps one place for the app screenshot", () => {
    expect(renderToStaticMarkup(<HomePage />)).toContain('aria-label="App screenshot coming soon"');
  });

  it("lists crisis help", () => {
    const text = renderText(<HomePage />);
    expect(text).toContain("call or text 988");
    expect(text).toContain("1-800-662-4357");
  });

  it("describes the app to search engines as a free MobileApplication", () => {
    const html = renderToStaticMarkup(<HomePage />);
    const json = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1] ?? "null";
    const data: unknown = JSON.parse(json);
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "MobileApplication",
      name: "mymeetingapp",
      operatingSystem: "iOS, Android",
      applicationCategory: "LifestyleApplication",
      description:
        "Find AA meetings near you and see how attendees describe them. Free, with no account, no ads and no tracking.",
      url: "https://mymeetingapp.test",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@type": "Organization", name: "Gooder Software LLC" },
    });
  });
});
