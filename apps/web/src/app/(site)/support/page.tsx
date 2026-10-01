import { BRAND, CATCH_UP_MINUTES } from "@mymeetingapp/shared";

import { HelpResources } from "@/components/help-resources";
import { pageMetadata } from "@/lib/page-metadata";
import { RETENTION } from "@/server/retention";

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
        Open the meeting and choose “Remove my tags”, or remove all of them at once on the app&apos;s Me tab
        with “Delete all my tags”. Both work at any time.
      </p>
      <h3>Switching phones?</h3>
      <p>
        Your tags stay with the phone that added them: a new phone gets a new ID, so it can&apos;t change
        them. If you want them gone, use “Delete all my tags” on the old phone first. Otherwise they stop
        counting {RETENTION.countWindowDays} days after you added them.
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
        website or list address, and we&apos;ll act on it within a few days. Once we do, we stop using your
        list at the next sync; meetings that other lists also publish keep appearing from those lists. The app
        catches up within {CATCH_UP_MINUTES.feedOptOut} minutes. You never need to give a reason.
      </p>
      <h3>For groups</h3>
      <p>
        If your group doesn&apos;t want to be tagged, email {email} with the meeting&apos;s name, day, time
        and address, and we&apos;ll act on it within a few days. Once we turn tags off, no new tags are
        accepted and none are shown. That takes effect right away on our server; the app catches up within{" "}
        {CATCH_UP_MINUTES.app} minutes.
      </p>

      <HelpResources />
    </>
  );
}
