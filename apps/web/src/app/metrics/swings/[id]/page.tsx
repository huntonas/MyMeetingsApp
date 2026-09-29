import { notFound } from "next/navigation";

import { blockSwingDeviceAction, closeSwingAction } from "@/app/metrics/actions";
import { utcTime } from "@/app/metrics/format";
import { Notice, type SearchParams } from "@/app/metrics/notice";
import { FormId } from "@/server/admin/form-fields";
import { readSwingReview } from "@/server/admin/swings";
import { RETENTION } from "@/server/retention";

export const dynamic = "force-dynamic";

// Spec §6: the one admin page that shows anything per phone, and only the phones behind one meeting's flag.
export default async function SwingReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const id = FormId.safeParse((await params).id);
  const review = id.success ? await readSwingReview(id.data) : undefined;
  if (review === undefined) notFound();
  const { swing, devices } = review;
  return (
    <>
      <h1>
        {swing.tagLabel} on {swing.meetingName}
      </h1>
      <Notice params={await searchParams} />
      <p>
        {swing.newDevices} new phones in 48 hours, {swing.priorDevices} before. Flagged{" "}
        {utcTime(swing.flaggedAt)}
        {swing.reviewedAt === null ? "." : `, closed ${utcTime(swing.reviewedAt)}.`}
      </p>
      <h2>Phones behind it</h2>
      <p className="fine-print">
        From the abuse-review log, which keeps a phone&apos;s link to a meeting for {RETENTION.auditDays}{" "}
        days. Only phones whose current tags here include “{swing.tagLabel}” are listed.
      </p>
      {devices.length === 0 ? (
        <p>None left to review.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Phone</th>
              <th>Last change</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.deviceHash}>
                <td>
                  <code>{device.deviceHash.slice(0, 12)}…</code>
                </td>
                <td>{utcTime(device.lastAt)}</td>
                <td>
                  {device.blocked ? (
                    "Blocked"
                  ) : (
                    <form
                      action={blockSwingDeviceAction}
                      className="inline"
                      aria-label={`Block phone ${device.deviceHash.slice(0, 12)}`}
                    >
                      <input type="hidden" name="swingId" value={swing.id} />
                      <input type="hidden" name="deviceHash" value={device.deviceHash} />
                      <button type="submit">Block</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {swing.reviewedAt === null ? (
        <form action={closeSwingAction} aria-label="Close this flag">
          <input type="hidden" name="swingId" value={swing.id} />
          <button type="submit" className="secondary">
            Close this flag
          </button>
        </form>
      ) : null}
    </>
  );
}
