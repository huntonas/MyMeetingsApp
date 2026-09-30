import { readEnv } from "@/env";

// The site's canonical origin, for the sitemap, robots.txt, Open Graph and canonical links. Connecting a domain
// later is a Vercel domain step plus a new SITE_URL. A missing or malformed value fails the build rather than
// publishing wrong links.
export function siteUrl(): string {
  const value = readEnv("SITE_URL");
  const url = value === undefined ? null : URL.parse(value);
  if (
    url === null ||
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("SITE_URL must be an http(s) origin such as https://mymeetingapp.vercel.app");
  }
  return url.origin;
}
