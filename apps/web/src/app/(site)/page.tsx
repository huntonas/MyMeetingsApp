import { Feature } from "@/components/feature";
import { HelpResources } from "@/components/help-resources";
import { MobileAppJsonLd } from "@/components/mobile-app-json-ld";
import { PhoneScreenshot } from "@/components/phone-screenshot";
import { PrivacyPromise } from "@/components/privacy-promise";
import { StoreBadge } from "@/components/store-badge";
import { pageMetadata, SITE_DESCRIPTION } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  path: "/",
  title: "Find AA meetings, described by the people who go",
  description: SITE_DESCRIPTION,
});

// What else the app does, as the App Store description lists it.
const ALSO_IN_THE_APP = [
  "Online meetings happening now.",
  "Directions in Apple Maps.",
  "A sobriety counter with milestones.",
  "Saved meetings that work offline.",
  "Help on every screen: 988 and the SAMHSA National Helpline.",
] as const;

export default function HomePage() {
  return (
    <div className="landing">
      <MobileAppJsonLd />
      <section className="hero" aria-labelledby="headline">
        <div className="hero-text">
          <h1 id="headline">Find an AA meeting that fits, described by the people who go.</h1>
          <p className="lede">
            A free app for iPhone that lists AA meetings near you and shows how the people who go describe
            each one, in a few plain words.
          </p>
          <p className="hero-promise">No account, no ads, no tracking.</p>
          <div className="get-app">
            <StoreBadge />
            <p className="fine-print">Android coming later.</p>
          </div>
        </div>
        <div className="hero-media">
          <PhoneScreenshot shot="nearby" preload />
        </div>
      </section>
      <div className="features">
        <Feature id="near-you" title="Meetings near you" media={<PhoneScreenshot shot="map" />}>
          <p>
            In-person, hybrid and online AA meetings across the United States, from the lists local AA offices
            publish. Search a city or zip code, or use your location.
          </p>
          <p>
            See what&apos;s on today, from now on, in a list or on a map, and filter by day, time, meeting
            type and tags. If nothing is close by, search farther, up to 60 miles.
          </p>
        </Feature>
        <Feature
          id="descriptions"
          title="Descriptions, not ratings"
          media={
            <div className="phone-pair">
              <PhoneScreenshot shot="meeting" />
              <PhoneScreenshot shot="tagPicker" />
            </div>
          }
        >
          <p>
            After a meeting, people who went can pick up to six words from a fixed list, like “Welcoming”,
            “Step study” or “Easy parking”. Each meeting shows how many people chose each word.
          </p>
          <p>
            There are no stars, scores or written reviews, so nothing ranks one meeting against another, and
            tags never describe people.
          </p>
        </Feature>
        <Feature id="private" title="Private by design" media={<PhoneScreenshot shot="me" />}>
          <PrivacyPromise />
        </Feature>
      </div>
      <section className="also" aria-labelledby="also">
        <h2 id="also">Also in the app</h2>
        <ul className="also-list">
          {ALSO_IN_THE_APP.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <HelpResources />
    </div>
  );
}
