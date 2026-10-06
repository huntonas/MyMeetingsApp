import type { MetadataRoute } from "next";

// Owner decision, 2026-10-06: until launch, no crawler reads any page; every page also says noindex (proxy.ts).
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
