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

  // catch-up.test.tsx checks how long each takes to reach the app.
  it("explains how an intergroup or other service entity stops the app using its list", () => {
    expect(text).toContain("For intergroups and other service entities");
    expect(text).toContain("we'll act on it within a few days");
  });

  it("explains how a group turns tags off", () => {
    expect(text).toContain("For groups");
    expect(text).toContain("Once we turn tags off, no new tags are accepted and none are shown");
  });

  it("says only the exact location stays on the phone, since a search sends a rounded point", () => {
    expect(text).toContain(
      "your exact location, sobriety date and favorites stay on your phone; a search sends only a point rounded to about 1 km",
    );
  });

  it("says email goes through Google Workspace, and where the policy covers it", () => {
    expect(text).toContain("Email to us goes through Google Workspace");
    expect(renderToStaticMarkup(<SupportPage />)).toContain('href="/privacy#email"');
  });

  it("says where “Delete all my tags” is", () => {
    expect(text).toContain("on the app's Me tab with “Delete all my tags”");
  });

  it("explains that tags stay with the phone that added them", () => {
    expect(text).toContain("Switching phones?");
    expect(text).toContain("use “Delete all my tags” on the old phone first");
    expect(text).toContain("they stop counting 180 days after you added them");
  });

  it("never asks for the app's ID, which nothing on our side uses", () => {
    expect(text).not.toMatch(/app ID/i);
  });

  it("doesn't claim the privacy policy lists everything", () => {
    expect(text).not.toContain("lists everything");
  });

  it("lists crisis help", () => {
    expect(text).toContain("call or text 988");
  });
});
