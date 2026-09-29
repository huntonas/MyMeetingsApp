import { describe, expect, it } from "vitest";

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
