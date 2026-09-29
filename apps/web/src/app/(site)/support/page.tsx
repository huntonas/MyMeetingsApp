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
        Email {email}. We read every message. Email to us goes through Google Workspace; the{" "}
        <a href="/privacy#email">privacy policy</a> says how long we keep it.
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
        No. There are no accounts, and your exact location, sobriety date and favorites stay on your phone; a
        search sends only a point rounded to about 1 km. The <a href="/privacy">privacy policy</a> explains
        what we keep and why.
      </p>

      <h2>Opting out</h2>
      <h3>For intergroups and other service entities</h3>
      <p>
        If you publish a meeting list and don&apos;t want {BRAND.appName} to use it, email {email} with your
        website or list address, and we&apos;ll act on it within a few days. Once we do, its meetings leave
        the app at the next sync, within about 15 minutes. You never need to give a reason.
      </p>
      <h3>For groups</h3>
      <p>
        If your group doesn&apos;t want to be tagged, email {email} with the meeting&apos;s name, day, time
        and address, and we&apos;ll act on it within a few days. Once we turn tags off, the app stops
        accepting new tags right away and stops showing them, with any cached copy catching up within 5
        minutes.
      </p>

      <HelpResources />
    </>
  );
}
