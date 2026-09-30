import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

const PUBLIC_PAGES = ["/", "/privacy", "/terms", "/support"];

// No lastModified: the pages carry no real date to give.
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((path) => ({ url: new URL(path, siteUrl()).href }));
}
