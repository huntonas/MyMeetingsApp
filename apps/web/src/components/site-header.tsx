import { BRAND } from "@mymeetingapp/shared";

// Plain links: the site ships no client-side navigation of its own.
export function SiteHeader() {
  return (
    <header className="site-header">
      <a className="wordmark" href="/">
        {BRAND.appName}
      </a>
      <nav aria-label="Site">
        <a href="/support">Support</a>
        <a href="/privacy">Privacy</a>
      </nav>
    </header>
  );
}
