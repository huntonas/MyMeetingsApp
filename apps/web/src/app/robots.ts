import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site-url";

// Spec §9. Built once at build time from SITE_URL.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/metrics", "/api/"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
