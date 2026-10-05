import { resumeFeedAction, saveOutreachAction } from "@/app/metrics/actions";
import { Notice, type SearchParams } from "@/app/metrics/notice";
import type { WaitingReason } from "@/db/schema";
import { listWaitingFeeds, type WaitingFeed } from "@/server/admin/waiting";

export const dynamic = "force-dynamic";

const REASONS: Record<WaitingReason, string> = {
  restricted: "Restricted list: ask for a sharing key",
  bot_check: "Bot check: ask them to let our User-Agent through",
};

function WaitingRow({ feed }: { feed: WaitingFeed }) {
  return (
    <tr>
      <td>
        {feed.name} ({feed.slug}, {feed.state})
        <br />
        <code>{feed.url}</code>
        <br />
        {feed.waitingReason === null ? null : REASONS[feed.waitingReason]}
      </td>
      <td>
        <form action={saveOutreachAction} aria-label={`Outreach: ${feed.slug}`}>
          <input type="hidden" name="feedId" value={feed.id} />
          <label>
            Contact email <input type="email" name="contactEmail" defaultValue={feed.contactEmail ?? ""} />
          </label>
          <label>
            Last contacted <input type="date" name="contactedOn" defaultValue={feed.contactedOn ?? ""} />
          </label>
          <label>
            Note <input name="outreachNote" defaultValue={feed.outreachNote ?? ""} />
          </label>
          <label>
            Sharing key <input name="accessKey" defaultValue={feed.accessKey ?? ""} />
          </label>
          <button type="submit" className="secondary">
            Save
          </button>
        </form>
      </td>
      <td>
        <form action={resumeFeedAction} className="inline" aria-label={`Resume: ${feed.slug}`}>
          <input type="hidden" name="feedId" value={feed.id} />
          <button type="submit">Permission granted, resume</button>
        </form>
      </td>
    </tr>
  );
}

export default async function WaitingPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, waiting] = await Promise.all([searchParams, listWaitingFeeds()]);
  return (
    <>
      <h1>Waiting for permission</h1>
      <Notice params={params} />
      <p>
        Feeds we can&apos;t read until their office lets us in. The sync never asks for them. Save a
        restricted list&apos;s sharing key before resuming it; we send it as <code>?key=</code>.
      </p>
      {waiting.length === 0 ? (
        <p>None.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Feed</th>
              <th>Outreach</th>
              <th>Office said yes</th>
            </tr>
          </thead>
          <tbody>
            {waiting.map((feed) => (
              <WaitingRow key={feed.id} feed={feed} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
