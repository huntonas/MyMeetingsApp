// The outcome of an admin action, shown on the page it returns to (?notice=<code>). Each admin view adds its own.
export const ADMIN_NOTICES = {
  failed: "Something went wrong; nothing was changed. Try again.",
  invalid_form:
    "That form wasn't valid, so nothing was changed. (A tag label is 2–40 letters, digits, spaces, apostrophes, hyphens or &.)",
  approved: "Added the new tag. The app's tag list usually picks it up within an hour.",
  merged: "Merged into the existing tag.",
  rejected: "Rejected.",
  already_reviewed: "That suggestion was already reviewed.",
  tag_exists: "A tag with that name already exists. Merge into it instead.",
  tag_retired: "Retired. The app usually stops offering it within an hour, and its counts are kept.",
  tag_restored: "Restored. The app offers it again within an hour.",
  tag_name_retired: "A retired tag already uses that name. Restore it under Vocabulary, then merge into it.",
  label_invalid: "That label has no letters a–z to make the tag's id from. Use Latin letters.",
  tag_not_found: "That tag isn't in the vocabulary, or has been retired.",
  blocked: "Blocked. That phone's tags no longer count, on this meeting or any other.",
  block_unfinished:
    "Something went wrong part-way: the phone may be blocked while its tags still count. Choose Block again to finish. If it already shows as blocked, finish with pnpm db:block-device (see docs/deploy.md).",
  not_in_review: "That phone isn't behind this flag (any more), so nothing was blocked.",
  closed: "Flag closed.",
  flag_not_found: "That flag is already closed or no longer exists.",
  tags_turned_off:
    "Tags are off for that meeting: none are accepted or shown. The app catches up within 5 minutes.",
  tags_turned_on: "Tags are back on for that meeting.",
  meeting_not_found: "That meeting no longer exists. Search for it again.",
  feed_opted_out: "Feed opted out. Its meetings leave the app at the next sync, within 15 minutes.",
  feed_opted_in: "Feed opted back in. It's fetched at the next sync.",
  feed_not_found: "That feed no longer exists.",
} as const;

export type AdminNotice = keyof typeof ADMIN_NOTICES;

// hasOwn, so a query string like ?notice=toString finds nothing.
export function isAdminNotice(value: unknown): value is AdminNotice {
  return typeof value === "string" && Object.hasOwn(ADMIN_NOTICES, value);
}
