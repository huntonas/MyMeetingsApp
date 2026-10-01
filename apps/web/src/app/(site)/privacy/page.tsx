import { BRAND, CATCH_UP_MINUTES } from "@mymeetingapp/shared";

import { DraftNotice } from "@/components/draft-notice";
import {
  DATA_INVENTORY,
  ON_PHONE,
  PHONE_BACKUP,
  SUPPORT_EMAIL,
  THIRD_PARTIES,
} from "@/content/privacy-inventory";
import { pageMetadata } from "@/lib/page-metadata";
import { RETENTION } from "@/server/retention";

export const metadata = pageMetadata({
  path: "/privacy",
  title: "Privacy policy",
  description: "Everything mymeetingapp stores, why, for how long, and who else receives it.",
});

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <DraftNotice />
      <p>
        {BRAND.appName} is made by {BRAND.publisher}, a Tennessee company. This policy covers the app for
        iPhone and Android and this website. It describes each kind of data we keep, why, and for how long.
      </p>

      <h2>In short</h2>
      <ul>
        <li>No accounts. We never ask for your name, email or phone number.</li>
        <li>We know your phone only by a keyed hash of the app&apos;s ID for it, never the ID itself.</li>
        <li>
          Our database doesn&apos;t record which meetings one phone has tagged. The only link between a phone
          and a meeting in our database is a {RETENTION.auditDays}-day abuse-review log. Your tags on each
          meeting are stored under an ID made for that meeting alone, so someone with only a copy of our
          database can&apos;t connect your tags on different meetings. Our server finds one phone&apos;s tags
          on different meetings only when you use “Delete all my tags” or when we block a phone for spam.
        </li>
        <li>No ads, analytics, tracking or cookies, in the app or on this website.</li>
      </ul>

      <h2>What stays on your phone</h2>
      <p>These stay on your phone and never reach our server:</p>
      <ul>
        {ON_PHONE.map((item) => (
          <li key={item.specItem}>{item.text}</li>
        ))}
      </ul>
      <p>{PHONE_BACKUP.text}</p>

      <h2>What our server stores</h2>
      {DATA_INVENTORY.map((entry) => (
        <section key={entry.specRow}>
          <h3>{entry.title}</h3>
          <dl>
            <dt>What</dt>
            <dd>{entry.what}</dd>
            <dt>Linked to</dt>
            <dd>{entry.linkedTo}</dd>
            <dt>How long</dt>
            <dd>{entry.kept}</dd>
          </dl>
        </section>
      ))}

      <h2 id="email">{SUPPORT_EMAIL.title}</h2>
      <p>
        {SUPPORT_EMAIL.what} {SUPPORT_EMAIL.kept} {SUPPORT_EMAIL.linkedTo}
      </p>

      <h2>Meeting listings</h2>
      <p>
        Meeting times and places come from meeting lists that AA intergroups and other service entities
        publish. We keep the meeting details (name, time, place, format, online links, dial-in numbers and
        notes), never the separate contact fields (names, emails, phone numbers) some lists include. Meeting
        notes are shown as the intergroup published them. We look up missing map locations with the US Census
        Bureau&apos;s geocoder, sending it only the meeting&apos;s address.
      </p>

      <h2>Who else receives data</h2>
      <dl>
        {THIRD_PARTIES.map((party) => (
          <div key={party.specName}>
            <dt>{party.name}</dt>
            <dd>{party.role}</dd>
          </div>
        ))}
      </dl>
      <p>
        When you type a place into the app&apos;s search box, your phone asks Apple, Google or, on some
        Android phones, the phone maker&apos;s location service to find it. We never receive what you typed,
        only the rounded point.
      </p>

      <h2>Backups</h2>
      <p>
        Deleted data can remain in our database provider&apos;s restore history for up to 30 days, and then
        it&apos;s gone. We use that history only to recover from a failure.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          Change or remove your tags on any meeting at any time, from the meeting&apos;s page in the app.
        </li>
        <li>
          “Delete all my tags” in the app&apos;s Settings deletes every tag, daily limit, abuse-log entry and
          phone record we hold for your phone, and any suggestion still linked to it (one we haven&apos;t
          reviewed, from the last {RETENTION.suggestionLinkDays} days) with its screening log. Tag counts
          update at once on our server; the app catches up within {CATCH_UP_MINUTES.app} minutes. A phone we
          blocked for spam keeps its blocked record.
        </li>
        <li>Location permission is optional. Without it, search by city, zip code or address.</li>
      </ul>

      <h2>Children</h2>
      <p>
        The app isn&apos;t meant for children under 13, and we don&apos;t knowingly collect anything from
        them. Apart from an email you choose to send us, we don&apos;t collect names, contact details or exact
        locations from anyone.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We&apos;ll post any change here with a new date. Questions go to{" "}
        <a href={`mailto:${BRAND.contactEmail}`}>{BRAND.contactEmail}</a>.
      </p>
      <p className="fine-print">Draft of 30 September 2026.</p>
    </>
  );
}
