import { BRAND } from "@mymeetingapp/shared";
import type { Metadata } from "next";
import type { ReactNode } from "react";

// Spec §10: never indexed. proxy.ts also sends X-Robots-Tag and no-store with every /metrics response.
export const metadata: Metadata = {
  title: `Metrics · ${BRAND.name}`,
  robots: { index: false, follow: false },
};

export default function MetricsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="site-header">
        <a className="wordmark" href="/metrics">
          {BRAND.name} metrics
        </a>
        <nav aria-label="Admin">
          <a href="/metrics">Overview</a>
          <a href="/metrics/suggestions">Suggestions</a>
          <a href="/metrics/swings">Swing flags</a>
          <a href="/metrics/opt-outs">Opt-outs</a>
          <a href="/metrics/vocabulary">Vocabulary</a>
        </nav>
      </header>
      <main className="page admin">{children}</main>
    </>
  );
}
