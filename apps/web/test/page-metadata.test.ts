import { describe, expect, it } from "vitest";

import { pageMetadata } from "@/lib/page-metadata";

describe("pageMetadata", () => {
  it("gives a page its title, description, canonical link and Open Graph card", () => {
    expect(
      pageMetadata({ path: "/privacy", title: "Privacy policy", description: "How we handle data." }),
    ).toEqual({
      title: "Privacy policy · My Meetings App",
      description: "How we handle data.",
      alternates: { canonical: "/privacy" },
      openGraph: {
        title: "Privacy policy · My Meetings App",
        description: "How we handle data.",
        url: "/privacy",
        siteName: "My Meetings App",
        type: "website",
        locale: "en_US",
      },
    });
  });
});
