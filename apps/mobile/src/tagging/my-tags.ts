import { z } from "zod";

import { appDatabase, inTransaction } from "@/db/database";

export interface MyTags {
  meetingId: string;
  // The meeting's name when it was tagged, for "Meetings I've tagged".
  name: string;
  tags: string[];
  confirmedAt: Date;
  updatedAt: Date;
}

const Row = z.object({
  meeting_id: z.string(),
  name: z.string(),
  tags: z.string(),
  confirmed_at: z.number(),
  updated_at: z.number(),
});

const Tags = z.array(z.string());

function parse(row: unknown): MyTags {
  const r = Row.parse(row);
  return {
    meetingId: r.meeting_id,
    name: r.name,
    tags: Tags.parse(JSON.parse(r.tags)),
    confirmedAt: new Date(r.confirmed_at),
    updatedAt: new Date(r.updated_at),
  };
}

// Spec §2, §8: this stays on the phone; nothing here is ever sent.
export async function myTagsOn(meetingId: string): Promise<MyTags | null> {
  const db = await appDatabase();
  const row = await db.getFirstAsync(
    "select meeting_id, name, tags, confirmed_at, updated_at from my_tags where meeting_id = ?",
    [meetingId],
  );
  return row === null ? null : parse(row);
}

// A new submission (or a re-confirmation a week or more later) the server accepted: both dates move to `at`.
export function recordSubmission(
  meeting: { id: string; name: string },
  tags: string[],
  at: Date,
): Promise<void> {
  return inTransaction(async (db) => {
    await db.runAsync(
      "insert or replace into my_tags (meeting_id, name, tags, confirmed_at, updated_at) values (?, ?, ?, ?, ?)",
      [meeting.id, meeting.name, JSON.stringify(tags), at.getTime(), at.getTime()],
    );
  });
}

// An edit the server accepted. It keeps the first confirmation; a phone that had no record (the server said it
// already tagged) starts one dated now.
export function recordEdit(meeting: { id: string; name: string }, tags: string[], at: Date): Promise<void> {
  return inTransaction(async (db) => {
    await db.runAsync(
      `insert into my_tags (meeting_id, name, tags, confirmed_at, updated_at) values (?, ?, ?, ?, ?)
       on conflict (meeting_id) do update set name = excluded.name, tags = excluded.tags, updated_at = excluded.updated_at`,
      [meeting.id, meeting.name, JSON.stringify(tags), at.getTime(), at.getTime()],
    );
  });
}

// The server holds no tags from this phone on these meetings (removed, or never there): their records go too.
export function forgetMyTags(...meetingIds: string[]): Promise<void> {
  return inTransaction(async (db) => {
    for (const id of meetingIds) await db.runAsync("delete from my_tags where meeting_id = ?", [id]);
  });
}

// "Meetings I've tagged", the latest change first.
export async function allMyTags(): Promise<MyTags[]> {
  const db = await appDatabase();
  const rows = await db.getAllAsync(
    "select meeting_id, name, tags, confirmed_at, updated_at from my_tags order by updated_at desc, rowid desc",
    [],
  );
  return rows.map(parse);
}

// After "Delete all my tags" succeeded on the server (owner decision 6), and never before.
export function forgetAllMyTags(): Promise<void> {
  return inTransaction(async (db) => {
    await db.runAsync("delete from my_tags", []);
  });
}
