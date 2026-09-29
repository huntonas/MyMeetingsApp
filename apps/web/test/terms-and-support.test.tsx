import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SupportPage from "@/app/(site)/support/page";
import TermsPage from "@/app/(site)/terms/page";

import { renderText } from "./render";

describe("the terms of use", () => {
  const text = renderText(<TermsPage />);

  it.each([
    "Draft, pending legal review.",
    "not affiliated with, endorsed by or approved by Alcoholics Anonymous or A.A. World Services, Inc.",
    "Listings can be out of date",
    "isn't medical advice",
    "governed by the laws of the State of Tennessee",
  ])("say %j (spec §9)", (words) => {
    expect(text).toContain(words);
  });
});

describe("the support page", () => {
  const text = renderText(<SupportPage />);

  it("gives the contact email as a link", () => {
    expect(renderToStaticMarkup(<SupportPage />)).toContain('href="mailto:admin@goodersoftwarellc.com"');
  });

  it("explains how an intergroup or other service entity stops the app using its list, and how long it takes", () => {
    expect(text).toContain("For intergroups and other service entities");
    expect(text).toContain("we'll act on it within a few days");
    expect(text).toContain(
      "Once we do, its meetings leave the app at the next sync, within about 15 minutes",
    );
  });

  it("explains how a group turns tags off, and how long it takes", () => {
    expect(text).toContain("For groups");
    expect(text).toContain("we'll act on it within a few days");
    expect(text).toContain(
      "Once we turn tags off, the app stops accepting new tags right away and stops showing them",
    );
  });

  it("lists crisis help", () => {
    expect(text).toContain("call or text 988");
  });
});
