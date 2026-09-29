import { PrivacyPromise } from "@/components/privacy-promise";
import { pageMetadata, SITE_DESCRIPTION } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  path: "/",
  title: "Find AA meetings, described by the people who go",
  description: SITE_DESCRIPTION,
});

export default function HomePage() {
  return (
    <>
      <section aria-labelledby="headline">
        <h1 id="headline">Find an AA meeting that fits, described by the people who go.</h1>
        <p className="lede">
          A free app for iPhone and Android that lists AA meetings near you and shows how attendees describe
          each one, in a few plain words.
        </p>
        <PrivacyPromise />
      </section>
      <section aria-labelledby="descriptions">
        <h2 id="descriptions">Descriptions, not ratings</h2>
        <p>
          After a meeting, attendees can pick up to six words from a fixed list, like “Welcoming”, “Step
          study” or “Easy parking”. The app shows how many people chose each one. There are no stars, no
          scores and no written reviews, so nobody can single out a group or a person.
        </p>
      </section>
    </>
  );
}
