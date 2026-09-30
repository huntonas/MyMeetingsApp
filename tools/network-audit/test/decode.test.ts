import { describe, expect, it } from "vitest";

import { views } from "../src/decode";

describe("views", () => {
  it("includes the raw text unchanged", () => {
    expect(views("plain text")).toContain("plain text");
  });

  it("percent-decodes a multi-byte UTF-8 sequence as one code point, not byte-by-byte", () => {
    // "%C3%A9" is "é" in UTF-8. Decoding each %XX as a separate Latin-1 char would produce mojibake instead.
    expect(views("Jos%C3%A9")).toContain("José");
  });

  it("leaves an invalid %zz sequence alone instead of throwing", () => {
    expect(() => views("%zz and Apr%2017")).not.toThrow();
    expect(views("%zz and Apr%2017")).toContain("%zz and Apr 17");
  });

  it("decodes a doubly percent-encoded value, capped at 3 passes", () => {
    // "Apr 17" single-encoded is "Apr%2017"; double-encoded re-escapes the literal "%".
    expect(views("Apr%252017")).toContain("Apr 17");
  });

  it("turns + into a space before percent-decoding", () => {
    expect(views("Apr+17%2C+2011")).toContain("Apr 17, 2011");
  });

  it("decodes decimal and hex HTML/XML numeric entities", () => {
    expect(views("Apr&#32;17")).toContain("Apr 17");
    expect(views("Apr&#x20;17")).toContain("Apr 17");
  });

  it("un-escapes a JSON \\uXXXX sequence via a parse/stringify round trip", () => {
    const withEscape = '{"note":"\\u0041pr 17"}';
    expect(views(withEscape).some((view) => view.includes("Apr 17"))).toBe(true);
  });

  it("also tries the JSON round trip on the percent-decoded view, not just the raw text", () => {
    const withEscape = '{"note":"\\u0041pr 17"}';
    const encoded = encodeURIComponent(withEscape);
    expect(views(encoded).some((view) => view.includes("Apr 17"))).toBe(true);
  });

  it("decodes an HTML entity that only appears after percent-decoding (%26%2350%3B011-04-17)", () => {
    // %26 -> "&", %23 -> "#", then literal "50", %3B -> ";", then literal "011-04-17": percent-decoding alone
    // gives "&#50;011-04-17"; only decoding entities *on that result* reveals "2011-04-17" (&#50; is "2").
    expect(views("%26%2350%3B011-04-17")).toContain("2011-04-17");
  });
});
