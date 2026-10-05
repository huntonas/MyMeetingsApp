import { waitForPermissionAction } from "@/app/metrics/actions";
import { utcTime } from "@/app/metrics/format";
import { readFeedsNeedingAttention, readMetrics } from "@/server/admin/metrics";

export const dynamic = "force-dynamic";

function share(part: number, whole: number): string {
  return whole === 0 ? "–" : `${String(Math.round((part / whole) * 100))}%`;
}

function Total({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default async function MetricsPage() {
  const [metrics, attention] = await Promise.all([readMetrics(), readFeedsNeedingAttention()]);
  const { devices, tagging } = metrics;
  return (
    <>
      <h1>Metrics</h1>
      <p className="fine-print">Totals only. Nothing on this page identifies a phone.</p>

      <h2>Phones</h2>
      <dl className="totals">
        <Total label="Active in the last 7 days" value={devices.active7} />
        <Total label="Active in the last 30 days" value={devices.active30} />
        <Total label="iPhone" value={devices.ios} />
        <Total label="Android" value={devices.android} />
        <Total label="Blocked" value={devices.blocked} />
      </dl>

      <h2>Tagging</h2>
      <dl className="totals">
        <Total label="Tag submissions this week" value={tagging.submissionsThisWeek} />
        <Total
          label="Near the meeting this week"
          value={share(tagging.nearMeetingThisWeek, tagging.submissionsThisWeek)}
        />
        <Total
          label="Meetings with tags"
          value={`${String(tagging.meetingsWithTags)} of ${String(tagging.meetings)}`}
        />
        <Total label="Suggestions waiting" value={metrics.pendingSuggestions} />
        <Total label="Open swing flags" value={metrics.openSwings} />
        <Total
          label="Tags in use / retired"
          value={`${String(metrics.vocabulary.active)} / ${String(metrics.vocabulary.retired)}`}
        />
      </dl>

      <h2>Submissions per day (UTC)</h2>
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>Submissions</th>
          </tr>
        </thead>
        <tbody>
          {metrics.submissionsPerDay.map((row) => (
            <tr key={row.day}>
              <td>{row.day}</td>
              <td>{row.count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Top tags (30 days)</h2>
      <ol>
        {metrics.topTags.map((tag) => (
          <li key={tag.label}>
            {tag.label}: {tag.submissions}
          </li>
        ))}
      </ol>

      <h2>Feeds</h2>
      <dl className="totals">
        <Total label="Feeds" value={metrics.feeds.total} />
        <Total label="Opted out" value={metrics.feeds.optedOut} />
        <Total label="Waiting for permission" value={metrics.feeds.waiting} />
        <Total label="Needing attention" value={metrics.feeds.needingAttention} />
      </dl>
      <h3>Feeds needing attention</h3>
      {attention.length === 0 ? (
        <p>None. Every feed is syncing on schedule.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Feed</th>
              <th>Last success</th>
              <th>Last attempt</th>
              <th>Error</th>
              <th>Office</th>
            </tr>
          </thead>
          <tbody>
            {attention.map((feed) => (
              <tr key={feed.slug}>
                <td>
                  {feed.name} ({feed.slug}, {feed.state})
                </td>
                <td>{utcTime(feed.lastSuccessAt)}</td>
                <td>{utcTime(feed.lastAttemptAt)}</td>
                <td>{feed.lastError ?? "Overdue"}</td>
                <td>
                  <form
                    action={waitForPermissionAction}
                    className="inline"
                    aria-label={`Wait for permission: ${feed.slug}`}
                  >
                    <input type="hidden" name="feedId" value={feed.id} />
                    <select name="reason" aria-label="Why">
                      <option value="bot_check">Bot check</option>
                      <option value="restricted">Restricted list</option>
                    </select>
                    <button type="submit" className="secondary">
                      Wait for permission
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
