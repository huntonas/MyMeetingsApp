import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage, { metadata } from "@/app/(site)/page";

import { decodeEntities, renderText } from "./render";

// The page's sections in order: [heading id, the section's markup].
function sections(): [string, string][] {
  const html = renderToStaticMarkup(<HomePage />);
  return [...html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"[^>]*>(.*?)<\/section>/g)].map((match) => [
    match[1] ?? "",
    match[2] ?? "",
  ]);
}

// Each screenshot's file name and alt text, in the order the markup shows them.
function screenshots(html: string): [string, string][] {
  return [...html.matchAll(/<img[^>]*>/g)].map(([img]) => [
    /screenshots(?:\/|%2F)([\w-]+\.webp)/.exec(img)?.[1] ?? "",
    decodeEntities(/alt="([^"]*)"/.exec(img)?.[1] ?? ""),
  ]);
}

describe("the landing page", () => {
  it("states the privacy promise in the hero, before any feature", () => {
    const text = renderText(<HomePage />);
    const promise = text.indexOf("No account, no ads, no tracking.");
    expect(promise).toBeGreaterThan(-1);
    expect(promise).toBeLessThan(text.indexOf("Meetings near you"));
  });

  it("is the canonical home page", () => {
    expect(metadata).toMatchObject({ alternates: { canonical: "/" }, openGraph: { url: "/" } });
  });

  it("says it's for iPhone now, with Android later", () => {
    const text = renderText(<HomePage />);
    expect(text).toContain("A free app for iPhone");
    expect(text).toContain("Android coming later.");
    expect(text).not.toContain("iPhone and Android");
  });

  it("has a hero, three features, the extras and help, in that order", () => {
    expect(sections().map(([id]) => id)).toEqual([
      "headline",
      "near-you",
      "descriptions",
      "private",
      "also",
      "help",
    ]);
    const text = renderText(<HomePage />);
    for (const heading of [
      "Meetings near you",
      "Descriptions, not ratings",
      "Private by design",
      "Also in the app",
      "Need help now?",
    ]) {
      expect(text).toContain(heading);
    }
  });

  it("shows each of the five App Store screenshots beside its part of the page, with alt text", () => {
    const shown = Object.fromEntries(
      sections().map(([id, html]) => [id, screenshots(html).map(([file]) => file)]),
    );
    expect(shown).toEqual({
      headline: ["1-nearby.webp"],
      "near-you": ["2-map.webp"],
      descriptions: ["3-meeting.webp", "4-tag-picker.webp"],
      private: ["5-me.webp"],
      also: [],
      help: [],
    });
    for (const [, alt] of screenshots(renderToStaticMarkup(<HomePage />))) {
      expect(alt.length).toBeGreaterThan(40);
    }
  });

  it("describes what each screenshot shows", () => {
    const alts = screenshots(renderToStaticMarkup(<HomePage />)).map(([, alt]) => alt);
    expect(alts.join(" ")).toContain("Welcoming 14");
    expect(alts.join(" ")).toContain("Lots of humor 13");
    expect(alts.join(" ")).toContain("365 days");
  });

  it("no longer holds a screenshot placeholder", () => {
    expect(renderToStaticMarkup(<HomePage />)).not.toContain("Screenshot coming soon");
  });
});

describe("the landing page's content", () => {
  it("explains meetings near you, the map and searching farther", () => {
    const text = renderText(<HomePage />);
    expect(text).toContain("in a list or on a map");
    expect(text).toContain("search farther, up to 60 miles");
  });

  it("says what the tags leave out, without claiming nobody can be singled out", () => {
    const text = renderText(<HomePage />);
    expect(text).toContain("pick up to six words from a fixed list");
    expect(text).toContain(
      "There are no stars, scores or written reviews, so nothing ranks one meeting against another, and tags never describe people.",
    );
    expect(text).not.toContain("single out");
  });

  it("keeps the full privacy promise, with a link to the policy", () => {
    const text = renderText(<HomePage />);
    expect(text).toContain("No account.");
    expect(text).toContain("Your exact location stays on your phone.");
    expect(text).toContain("Your sobriety date and saved meetings stay on your phone.");
    expect(text).toContain("No ads, no tracking, no analytics and no cookies,");
    expect(renderToStaticMarkup(<HomePage />)).toContain('href="/privacy"');
  });

  it("lists what else is in the app", () => {
    const text = renderText(<HomePage />);
    for (const item of [
      "Online meetings happening now.",
      "Directions in Apple Maps.",
      "A sobriety counter with milestones.",
      "Saved meetings that work offline.",
    ]) {
      expect(text).toContain(item);
    }
  });

  it("shows the App Store as coming soon, with no store links yet", () => {
    const text = renderText(<HomePage />);
    expect(text).toContain("Coming soon on the App Store");
    expect(text).not.toContain("Google Play");
    expect(renderToStaticMarkup(<HomePage />)).not.toMatch(/apps\.apple\.com|play\.google\.com/);
  });

  it("marks the store badge as plain text, not as a disabled control", () => {
    expect(renderToStaticMarkup(<HomePage />)).not.toContain("aria-disabled");
  });

  it("lists crisis help", () => {
    const text = renderText(<HomePage />);
    for (const words of [
      "988 Suicide & Crisis Lifeline",
      "call or text 988",
      "any time.",
      "SAMHSA National Helpline",
      "1-800-662-4357",
      "free and confidential, 24 hours a day.",
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

  it("describes the app to search engines as a free MobileApplication for iOS", () => {
    const html = renderToStaticMarkup(<HomePage />);
    const json = /<script type="application\/ld\+json">(.*?)<\/script>/.exec(html)?.[1] ?? "null";
    const data: unknown = JSON.parse(json);
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "MobileApplication",
      name: "My Meeting App",
      operatingSystem: "iOS",
      applicationCategory: "LifestyleApplication",
      description:
        "Find recovery meetings near you and see how attendees describe them. Free, with no account, no ads and no tracking.",
      url: "https://mymeetingapp.test",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@type": "Organization", name: "Gooder Software LLC" },
    });
  });
});
