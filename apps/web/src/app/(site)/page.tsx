import { HelpResources } from "@/components/help-resources";
import { pageMetadata, SITE_DESCRIPTION } from "@/lib/page-metadata";

export const metadata = pageMetadata({ path: "/", title: "Coming soon", description: SITE_DESCRIPTION });

// Owner decision, 2026-10-06: until launch, the home page says only that the app is coming soon. The crisis lines
// stay (spec §8), as do the privacy policy, terms and support page, which the App Store listing links to.
export default function HomePage() {
  return (
    <div className="coming-soon">
      <h1>My Meeting App</h1>
      <p className="lede">Coming soon.</p>
      <HelpResources />
    </div>
  );
}
