// The outcome of an admin action, shown on the page it returns to (?notice=<code>). Each admin view adds its own.
export const ADMIN_NOTICES = {
  failed: "Something went wrong; nothing was changed. Try again.",
  invalid_form:
    "Something in that form wasn't valid. A label is 2–40 letters, digits, spaces, apostrophes, hyphens or &.",
  approved: "Added the new tag. The app's tag list usually picks it up within an hour.",
  merged: "Merged into the existing tag.",
  rejected: "Rejected.",
  already_reviewed: "That suggestion was already reviewed.",
  tag_exists: "A tag with that name already exists. Merge into it instead.",
  tag_retired: "A retired tag already uses that name. Restore it under Tags, then merge into it.",
  label_invalid: "That label has no letters a–z to make the tag's id from. Use Latin letters.",
  tag_not_found: "That tag isn't in the vocabulary, or has been retired.",
} as const;

export type AdminNotice = keyof typeof ADMIN_NOTICES;

// hasOwn, so a query string like ?notice=toString finds nothing.
export function isAdminNotice(value: unknown): value is AdminNotice {
  return typeof value === "string" && Object.hasOwn(ADMIN_NOTICES, value);
}
