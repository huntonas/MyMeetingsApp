import type { ReactNode } from "react";

import { SiteHeader } from "@/components/site-header";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="page">{children}</main>
    </>
  );
}
