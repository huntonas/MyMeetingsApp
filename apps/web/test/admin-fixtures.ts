import { eq } from "drizzle-orm";

import { POST as tagMeeting } from "@/app/api/v1/tags/route";
import { db } from "@/db/client";
import { suggestions, tagSwings } from "@/db/schema";
import { foldDeviceDays } from "@/server/devices/device-days";

import { DEVICE_A_HASH, DEVICE_B, deviceHeaders, seedMeetingStarted, testDevice } from "./tag-fixtures";

// The FormData a browser sends for these fields.
export function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

// A suggestion from DEVICE_A, waiting for review.
export async function pendingSuggestion(text: string): Promise<number> {
  const [row] = await db
    .insert(suggestions)
    .values({ text, deviceHash: DEVICE_A_HASH })
    .returning({ id: suggestions.id });
  if (row === undefined) throw new Error("the suggestion was not saved");
  return row.id;
}

export async function suggestionRow(id: number) {
  const [row] = await db
    .select({
      status: suggestions.status,
      mergedTagId: suggestions.mergedTagId,
      deviceHash: suggestions.deviceHash,
      reviewedAt: suggestions.reviewedAt,
    })
    .from(suggestions)
    .where(eq(suggestions.id, id));
  return row;
}

async function tag(meetingId: string, slugs: string[], headers: Record<string, string>): Promise<void> {
  const res = await tagMeeting(
    new Request("http://test/api/v1/tags", {
      method: "POST",
      headers,
      body: JSON.stringify({ meetingId, tags: slugs }),
    }),
  );
  if (res.status !== 201) throw new Error(`tagging answered ${String(res.status)}`);
}

// A flag on "serious-tone": DEVICE_A and four more phones add it within the hour. DEVICE_B, also in the audit log,
// adds only "quiet".
export async function seedSwing(): Promise<{ meetingId: string; swingId: number }> {
  const meetingId = await seedMeetingStarted(1);
  await tag(meetingId, ["serious-tone"], deviceHeaders());
  for (let n = 1; n <= 4; n++) await tag(meetingId, ["serious-tone"], deviceHeaders(testDevice(n)));
  await tag(meetingId, ["quiet"], deviceHeaders(DEVICE_B, "android"));
  await foldDeviceDays();
  const [swing] = await db.select({ id: tagSwings.id }).from(tagSwings);
  if (swing === undefined) throw new Error("no swing was flagged");
  return { meetingId, swingId: swing.id };
}
