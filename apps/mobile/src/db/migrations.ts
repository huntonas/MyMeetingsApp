// Append-only. Each entry runs once, in order, and is never edited after it ships: the phone's `user_version` counts
// how many have run. Everything here stays on the phone (spec §2, §13).
export const MIGRATIONS: readonly string[] = [
  `create table cache_entries (key text primary key, body text not null, saved_at integer not null) strict;`,
];
