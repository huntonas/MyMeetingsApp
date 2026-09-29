import { setFeedOptOutAction, setMeetingTagsAction } from "@/app/metrics/actions";
import { Notice, type SearchParams } from "@/app/metrics/notice";
import { searchQuery } from "@/app/metrics/search-query";
import {
  type FeedMatch,
  findFeeds,
  findMeetings,
  listOptedOutFeeds,
  listTagOptOuts,
  type MeetingMatch,
} from "@/server/admin/opt-outs";

export const dynamic = "force-dynamic";

// Meeting Guide numbers days from Sunday.
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MIN_QUERY = 2;

const dayName = (day: number) => DAYS[day] ?? "Unknown day";

function MeetingRows({ meetings }: { meetings: MeetingMatch[] }) {
  if (meetings.length === 0) return null;
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Day / time</th>
          <th>Address</th>
          <th>Tags</th>
        </tr>
      </thead>
      <tbody>
        {meetings.map((meeting) => {
          const action = meeting.tagsDisabled ? "Turn tags back on" : "Turn tags off";
          return (
            <tr key={meeting.id}>
              <td>{meeting.name}</td>
              <td>
                {dayName(meeting.day)} {meeting.time}
              </td>
              <td>{meeting.address ?? "Online"}</td>
              <td>
                <form
                  action={setMeetingTagsAction}
                  className="inline"
                  aria-label={`${action} for ${meeting.name}, ${dayName(meeting.day)} ${meeting.time}`}
                >
                  <input type="hidden" name="meetingId" value={meeting.id} />
                  <input type="hidden" name="tagsDisabled" value={meeting.tagsDisabled ? "false" : "true"} />
                  <button type="submit" className={meeting.tagsDisabled ? "secondary" : undefined}>
                    {action}
                  </button>
                </form>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FeedRows({ feeds }: { feeds: FeedMatch[] }) {
  if (feeds.length === 0) return null;
  return (
    <table>
      <thead>
        <tr>
          <th>Feed</th>
          <th>Opted out</th>
        </tr>
      </thead>
      <tbody>
        {feeds.map((feed) => {
          const action = feed.optedOut ? "Opt back in" : "Opt out";
          return (
            <tr key={feed.id}>
              <td>
                {feed.name} ({feed.slug}, {feed.state})
              </td>
              <td>
                <form action={setFeedOptOutAction} className="inline" aria-label={`${action}: ${feed.name}`}>
                  <input type="hidden" name="feedId" value={feed.id} />
                  <input type="hidden" name="optedOut" value={feed.optedOut ? "false" : "true"} />
                  <button type="submit" className={feed.optedOut ? "secondary" : undefined}>
                    {action}
                  </button>
                </form>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function OptOutsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const meetingQuery = searchQuery(params.q);
  const feedQuery = searchQuery(params.feed);
  const [meetingsFound, tagsOff, feedsFound, feedsOut] = await Promise.all([
    meetingQuery.length >= MIN_QUERY ? findMeetings(meetingQuery) : [],
    listTagOptOuts(),
    feedQuery.length >= MIN_QUERY ? findFeeds(feedQuery) : [],
    listOptedOutFeeds(),
  ]);
  return (
    <>
      <h1>Opt-outs</h1>
      <Notice params={params} />

      <h2>Groups: tags off</h2>
      <p>For a group that asked not to be tagged. No tags are accepted or shown for its meeting.</p>
      <form method="get" action="/metrics/opt-outs" className="inline" role="search">
        <label>
          Meeting name, group or address <input name="q" defaultValue={meetingQuery} minLength={MIN_QUERY} />
        </label>
        <button type="submit" className="secondary">
          Find
        </button>
      </form>
      <MeetingRows meetings={meetingsFound} />
      <h3>Tags off now</h3>
      {tagsOff.length === 0 ? <p>None.</p> : <MeetingRows meetings={tagsOff} />}

      <h2>Feeds: opted out</h2>
      <p>
        For an intergroup or service entity that asked us to stop using its list. Also add{" "}
        <code>opted_out: true</code> to its entry in <code>tools/feed-discovery/registry.yaml</code>.
      </p>
      <form method="get" action="/metrics/opt-outs" className="inline" role="search">
        <label>
          Feed name, slug or website <input name="feed" defaultValue={feedQuery} minLength={MIN_QUERY} />
        </label>
        <button type="submit" className="secondary">
          Find
        </button>
      </form>
      <FeedRows feeds={feedsFound} />
      <h3>Opted out now</h3>
      {feedsOut.length === 0 ? <p>None.</p> : <FeedRows feeds={feedsOut} />}
    </>
  );
}
