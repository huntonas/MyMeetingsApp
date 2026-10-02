import { BRAND } from "@mymeetingapp/shared";

// Spec §9: the non-affiliation statement on every page, admin pages included.
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <p>
        {BRAND.name} is not affiliated with or endorsed by Alcoholics Anonymous or A.A. World Services, Inc.
      </p>
      <nav aria-label="Legal">
        <a href="/privacy">Privacy policy</a>
        <a href="/terms">Terms of use</a>
        <a href="/support">Support</a>
      </nav>
      <p>© {BRAND.publisher}</p>
    </footer>
  );
}
