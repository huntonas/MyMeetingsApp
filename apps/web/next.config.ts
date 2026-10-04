import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mymeetingapp/shared"],
  // The site's only images are the app screenshots in public/, already sized for the web, so they're served as
  // they are rather than re-encoded on request.
  images: { unoptimized: true },
};

export default nextConfig;
