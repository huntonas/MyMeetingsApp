import { BRAND } from "@mymeetingapp/shared";

import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  path: "/terms",
  title: "Terms of use",
  description: `The terms for using the ${BRAND.name} app and website.`,
});

export default function TermsPage() {
  return (
    <>
      <h1>Terms of use</h1>
      <p>
        These terms cover the {BRAND.name} app and this website, made by {BRAND.publisher} (“we”). By using
        them, you agree to these terms.
      </p>

      <h2>Not affiliated with Alcoholics Anonymous</h2>
      <p>
        {BRAND.name} is an independent app. It is not affiliated with, endorsed by or approved by Alcoholics
        Anonymous or A.A. World Services, Inc.
      </p>

      <h2>Listings can be out of date</h2>
      <p>
        Meeting listings come from lists that intergroups and other service entities publish. They change
        often, and we can&apos;t check them. A meeting may have moved, changed its time or stopped meeting.
        When it matters, check with the group or the local intergroup.
      </p>

      <h2>Not medical advice</h2>
      <p>
        The app helps you find meetings. It isn&apos;t medical advice, treatment or a crisis service. If you
        are in crisis, call or text 988, or call the SAMHSA National Helpline at 1-800-662-4357.
      </p>

      <h2>Tags and suggestions</h2>
      <p>
        Tags come from a fixed list and describe a meeting, not people. Don&apos;t use tags or suggestions to
        harass, advertise or mislead. We may block phones that send spam, which stops their tags from
        counting.
      </p>

      <h2>The app is provided as it is</h2>
      <p>
        The app is free and provided “as is”, without warranties of any kind. As far as the law allows, we
        aren&apos;t liable for any loss that comes from using it or from a listing being wrong.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the State of Tennessee, and any dispute will be heard in the
        courts of Tennessee.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We&apos;ll post any change here with a new date. Questions go to{" "}
        <a href={`mailto:${BRAND.contactEmail}`}>{BRAND.contactEmail}</a>.
      </p>
      <p className="fine-print">Updated 2 October 2026.</p>
    </>
  );
}
