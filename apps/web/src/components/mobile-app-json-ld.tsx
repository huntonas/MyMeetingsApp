import { BRAND } from "@mymeetingapp/shared";

import { SITE_DESCRIPTION } from "@/lib/page-metadata";
import { siteUrl } from "@/lib/site-url";

// Spec §9: schema.org MobileApplication, on iOS only until the Android app ships. There is no rating on purpose (the
// app has none), so search engines show no rich result, but the facts are there. "<" is escaped so the text can never close the script element.
export function MobileAppJsonLd() {
  const data = {
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    name: BRAND.name,
    operatingSystem: "iOS",
    applicationCategory: "LifestyleApplication",
    description: SITE_DESCRIPTION,
    url: siteUrl(),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@type": "Organization", name: BRAND.publisher },
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
