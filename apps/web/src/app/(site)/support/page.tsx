import { BRAND } from "@mymeetingapp/shared";

import { HelpResources } from "@/components/help-resources";
import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata({
  path: "/support",
  title: "Support",
  description: "Help with mymeetingapp, and how intergroups and groups can opt out.",
});

export default function SupportPage() {
  const email = <a href={`mailto:${BRAND.contactEmail}`}>{BRAND.contactEmail}</a>;
  return (
    <>
      <h1>Support</h1>
      <p>
        Email {email}. We read every message. If your question is about your tags, include the app ID shown in
        the app&apos;s Settings.
      </p>

      <h2>Common questions</h2>
      <h3>How do I remove my tags?</h3>
      <p>
        Open the meeting and choose “Remove my tags”, or remove all of them at once in Settings with “Delete
        all my tags”. Both work at any time.
      </p>
      <h3>Why can&apos;t I tag a meeting?</h3>
      <p>
        New tags can be added from the start of a meeting until 36 hours later, once per meeting every 7 days.
        You can change your tags at any time.
      </p>
      <h3>A meeting&apos;s details are wrong</h3>
      <p>
        Listings come from the local intergroup or service entity. Please let them know. The app picks up
        their changes within about a week.
      </p>
      <h3>Does the app know who I am?</h3>
      <p>
        No. There are no accounts, and your location and personal details stay on your phone. The{" "}
        <a href="/privacy">privacy policy</a> lists everything we store.
      </p>

      <h2>Opting out</h2>
      <h3>For intergroups and other service entities</h3>
      <p>
        If you publish a meeting list and don&apos;t want {BRAND.appName} to use it, email {email} with your
        website or list address, and we&apos;ll stop using it. Its meetings leave the app at the next sync,
        within about 15 minutes. You never need to give a reason.
      </p>
      <h3>For groups</h3>
      <p>
        If your group doesn&apos;t want to be tagged, email {email} with the meeting&apos;s name, day, time
        and address. We&apos;ll turn tags off for it: the app stops accepting new tags right away and stops
        showing existing ones, with any cached copy of the meeting catching up within 5 minutes.
      </p>

      <HelpResources />
    </>
  );
}
