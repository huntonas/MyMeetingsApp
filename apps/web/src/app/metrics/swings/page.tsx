import { utcTime } from "@/app/metrics/format";
import { Notice, type SearchParams } from "@/app/metrics/notice";
import { listOpenSwings } from "@/server/admin/swings";

export const dynamic = "force-dynamic";

export default async function SwingsPage({ searchParams }: { searchParams: SearchParams }) {
  const swings = await listOpenSwings();
  return (
    <>
      <h1>Swing flags</h1>
      <Notice params={await searchParams} />
      <p>
        A flag means one tag suddenly gained 5 or more new phones on a meeting that had fewer than 10. Nothing
        is blocked automatically.
      </p>
      {swings.length === 0 ? (
        <p>No open flags.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Meeting</th>
              <th>Tag</th>
              <th>New / earlier phones</th>
              <th>Flagged</th>
            </tr>
          </thead>
          <tbody>
            {swings.map((swing) => (
              <tr key={swing.id}>
                <td>
                  <a href={`/metrics/swings/${String(swing.id)}`}>{swing.meetingName}</a>
                </td>
                <td>{swing.tagLabel}</td>
                <td>
                  {swing.newDevices} / {swing.priorDevices}
                </td>
                <td>{utcTime(swing.flaggedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
