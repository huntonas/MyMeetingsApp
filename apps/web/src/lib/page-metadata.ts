import { BRAND } from "@mymeetingapp/shared";
import type { Metadata } from "next";

export const SITE_DESCRIPTION =
  "Find recovery meetings near you and see how attendees describe them. Free, with no account, no ads and no tracking.";

// The one way a page names itself. Next.js replaces a layout's openGraph object rather than merging it, so every
// page's card carries the site name, type and locale itself. Relative URLs resolve against the root layout's
// metadataBase (SITE_URL).
export function pageMetadata(page: { path: string; title: string; description: string }): Metadata {
  const title = `${page.title} · ${BRAND.name}`;
  return {
    title,
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: {
      title,
      description: page.description,
      url: page.path,
      siteName: BRAND.name,
      type: "website",
      locale: "en_US",
    },
  };
}
