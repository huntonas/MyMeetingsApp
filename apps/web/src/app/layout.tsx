import { BRAND } from "@mymeetingapp/shared";
import type { Metadata } from "next";
import { Atkinson_Hyperlegible } from "next/font/google";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/site-footer";
import { SITE_DESCRIPTION } from "@/lib/page-metadata";
import { siteUrl } from "@/lib/site-url";

import "./globals.css";

// Self-hosted: next/font downloads the files at build time and serves them from this site, so no visitor's browser
// contacts Google (spec §2, §9).
const atkinson = Atkinson_Hyperlegible({ weight: ["400", "700"], subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  applicationName: BRAND.appName,
  description: SITE_DESCRIPTION,
  twitter: { card: "summary" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={atkinson.className}>
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
