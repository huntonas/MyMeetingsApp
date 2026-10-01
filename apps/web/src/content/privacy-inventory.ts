import { BRAND } from "@mymeetingapp/shared";

import { RETENTION } from "@/server/retention";

interface InventoryEntry {
  // The row's name in SPEC.md §13's stored-data table, without backticks.
  specRow: string;
  // The row's other cells exactly as SPEC.md has them, without backticks. Any edit to the row fails
  // privacy-policy.test.tsx until this copy is updated, which is the prompt to review the wording below.
  specCells: { contents: string; linkedTo: string; retention: string };
  // The table that holds it and every one of its columns (a new column fails the test until the policy covers
  // it), or null for data we never store.
  table: { name: string; columns: readonly string[] } | null;
  title: string;
  what: string;
  linkedTo: string;
  kept: string;
}

// Spec §13 in plain words, one entry per row. The privacy policy renders this, and privacy-policy.test.tsx fails when
// it drifts from SPEC.md or the database schema. Periods come from RETENTION, which the code enforcing them reads.
// Every purge runs in the nightly maintenance job, so data can outlast its period by up to a day.
export const DATA_INVENTORY: readonly InventoryEntry[] = [
  {
    specRow: "devices",
    specCells: {
      contents: "device hash, platform, first/last seen date, blocked flag, attestation key",
      linkedTo: "nothing else",
      retention: "until delete-mine; inactive 13 months → deleted (blocked devices kept, see §6)",
    },
    table: {
      name: "devices",
      columns: ["device_hash", "platform", "first_seen_date", "last_seen_date", "blocked"],
    },
    title: "Your phone's record",
    what: "A keyed hash of the app's ID for your phone (never the ID itself), whether it's an iPhone or an Android phone, the first and last day the app sent us tags or a suggestion (dates only), whether we've blocked it for spam and, once app checks are switched on, the app's attestation key. On iPhone, the app makes a random ID and keeps it in the iPhone's Keychain, on that phone only: it isn't synced to iCloud Keychain or restored to another phone, and it stays if you delete and reinstall the app. On Android, the app uses Android's own ID for the app, which a factory reset changes. The app sends it only when you add, change or remove tags, suggest a tag or use “Delete all my tags”, never when you search or read meetings.",
    linkedTo: "Nothing else. It doesn't mention any meeting.",
    kept: `Until you use “Delete all my tags”, or until the first nightly cleanup ${String(RETENTION.inactiveDeviceMonths)} months after the app last sent us tags or a suggestion. If we blocked your phone for spam, we keep its hash, platform, dates and blocked flag for as long as the block stands, even after “Delete all my tags” or ${String(RETENTION.inactiveDeviceMonths)} months without contact. That record still isn't linked to any meeting.`,
  },
  {
    specRow: "tag_submissions",
    specCells: {
      contents: "per-meeting submitter ID, tags, nearMeeting, dates",
      linkedTo: "one meeting only",
      retention: "until edited/deleted; counts only use 180 days",
    },
    table: {
      name: "tag_submissions",
      columns: [
        "meeting_id",
        "submitter_id",
        "scope_meeting_id",
        "tag_ids",
        "near_meeting",
        "confirmed_at",
        "updated_at",
        "excluded",
      ],
    },
    title: "Your tags on a meeting",
    what: "The tags you chose for one meeting, whether the app confirmed you were near it (yes or no, never where you were), the dates, and whether we've set them aside because we blocked the phone for spam. They're stored under an ID made for that meeting alone, so someone with only a copy of our database can't connect your tags on two meetings.",
    linkedTo:
      "That one meeting. Our server finds one phone's tags on different meetings only when you use “Delete all my tags” or when we block a phone for spam.",
    kept: `Until you change or remove them. The counts in the app only include tags confirmed in the last ${String(RETENTION.countWindowDays)} days.`,
  },
  {
    specRow: "tag_counts",
    specCells: {
      contents: "meeting, tag, device count, near-meeting count",
      linkedTo: "one meeting only",
      retention: "rebuilt on every tag write and nightly",
    },
    table: { name: "tag_counts", columns: ["meeting_id", "tag_id", "device_count", "verified_count"] },
    title: "Tag counts",
    what: "For each meeting and tag, how many phones chose it and how many of those were near the meeting.",
    linkedTo: "One meeting.",
    kept: "Rebuilt every time tags change, and every night.",
  },
  {
    specRow: "tag_audit",
    specCells: {
      contents: "device hash, meeting, action, time",
      linkedTo: "device + meeting",
      retention: "7 days",
    },
    table: { name: "tag_audit", columns: ["id", "device_hash", "meeting_id", "action", "at"] },
    title: "Abuse-review log",
    what: "Your phone's hash, a meeting, whether you added or changed tags, and when.",
    linkedTo:
      "Your phone and one meeting. This is the only link between a phone and a meeting in our database, kept so we can find and block spam.",
    kept: `${String(RETENTION.auditDays)} days, then deleted in the next nightly cleanup.`,
  },
  {
    specRow: "tag_swings",
    specCells: {
      contents: "meeting, tag, new and prior device counts, flagged/reviewed time",
      linkedTo: "one meeting only",
      retention: "kept",
    },
    table: {
      name: "tag_swings",
      columns: ["id", "meeting_id", "tag_id", "new_devices", "prior_devices", "flagged_at", "reviewed_at"],
    },
    title: "Spam flags",
    what: "When one tag suddenly gains many new phones on a meeting: the meeting, the tag, how many new and earlier phones, and when we flagged and reviewed it.",
    linkedTo: "One meeting. No phone.",
    kept: "Kept.",
  },
  {
    specRow: "meeting_aliases",
    specCells: {
      contents: "merged-away meeting id, surviving meeting id",
      linkedTo: "meetings only",
      retention: "kept",
    },
    table: { name: "meeting_aliases", columns: ["old_meeting_id", "meeting_id"] },
    title: "Merged meetings",
    what: "When two listings turn out to be the same meeting, the old meeting ID and the one it became.",
    linkedTo: "Meetings only.",
    kept: "Kept.",
  },
  {
    specRow: "rate_limits",
    specCells: {
      contents:
        "device hash, bucket, count (plus one site-wide count of failed /metrics sign-ins, with no device)",
      linkedTo: "device only (the sign-in count: nothing)",
      retention: "2 days",
    },
    table: { name: "rate_limits", columns: ["device_hash", "bucket", "window_start", "count"] },
    title: "Daily limits",
    what: "Your phone's hash, which daily limit it counts (new tags or suggestions), the day (UTC) and how many you've used that day. A separate count of failed sign-ins to our admin page covers the whole site and names no phone.",
    linkedTo: "Your phone only; the sign-in count links to nothing.",
    kept: `${String(RETENTION.rateLimitDays)} days: today's and yesterday's counts (UTC) are kept, and older ones are deleted in the next nightly cleanup.`,
  },
  {
    specRow: "suggestions",
    specCells: {
      contents:
        "text, status (pending, approved, merged, rejected), the tag it became or joined; device hash until reviewed",
      linkedTo: "device (temporary)",
      retention: "text kept; device link ≤ 30 days; deleted by delete-mine while still linked",
    },
    table: {
      name: "suggestions",
      columns: ["id", "text", "status", "merged_tag_id", "device_hash", "created_at", "reviewed_at"],
    },
    title: "Suggested tags",
    what: "The word or phrase you suggested, and whether we added it, merged it into an existing tag or turned it down. Until we review it, it's also linked to your phone's hash.",
    linkedTo: "Your phone, but only until review.",
    kept: `The text is kept. The link to your phone goes when we review the suggestion, or in the first nightly cleanup after ${String(RETENTION.suggestionLinkDays)} days, whichever comes first. “Delete all my tags” deletes any suggestion still linked to you.`,
  },
  {
    specRow: "ai_decisions",
    specCells: {
      contents: "suggestion text, AI decision, reason, model, time",
      linkedTo: "a suggestion (device link via the suggestion ≤ 30 days)",
      retention: "kept; deleted with its suggestion by delete-mine",
    },
    table: {
      name: "ai_decisions",
      columns: ["id", "suggestion_id", "input", "decision", "tag_slug", "reason", "model", "decided_at"],
    },
    title: "Suggestion screening log",
    what: "The suggested text, what the screening model decided (merge it into an existing tag, reject it or leave it for a person), which tag it named for a merge, its reason, the model's name and the time.",
    linkedTo:
      "One suggestion, and through it your phone for as long as that suggestion stays linked to it (see “Suggested tags”).",
    kept: "Kept, including the suggestion's text. “Delete all my tags” deletes it together with a suggestion still linked to you.",
  },
  {
    specRow: "Search request",
    specCells: {
      contents: "rounded lat/lng (~1 km)",
      linkedTo: "nothing",
      retention: "not stored; used for one query",
    },
    table: null,
    title: "Search location",
    what: "When you search, the app rounds the location to about 1 km (two decimal places) and sends it in the body of the request, never in a web address.",
    linkedTo: "Nothing.",
    kept: "Not stored. It's used for that one search and never written to a log.",
  },
  {
    specRow: "Vercel request logs",
    specCells: {
      contents: "IP, path, time",
      linkedTo: "nothing we control",
      retention: "Vercel plan retention",
    },
    table: null,
    title: "Hosting request logs",
    what: "Our host, Vercel, records each request's IP address, the page or API path, and the time. When the app loads a meeting or saves your tags, the path names that meeting.",
    linkedTo: "Nothing we control. We never add request contents, headers or locations to these logs.",
    kept: "For the short time Vercel's plan keeps them. We don't copy them anywhere.",
  },
];

// Spec §13's support-email row. The privacy policy gives it its own section, since the mailbox isn't our server.
// Owner decision: we delete a message within 90 days after it's resolved (a quarterly owner step in docs/deploy.md);
// no code enforces that, so RETENTION doesn't hold it. Gmail keeps deleted mail in Trash for 30 days, and a
// Workspace admin can recover it for about 25 more.
export const SUPPORT_EMAIL: InventoryEntry = {
  specRow: "Support email",
  specCells: {
    contents: "sender's email address, message (in Google Workspace); kept only to answer and act on it",
    linkedTo: "nothing else (never tags)",
    retention: "until resolved, then deleted within 90 days; Google trash and recovery ≤ 55 days more",
  },
  table: null,
  title: "When you email us",
  what: `Email to ${BRAND.contactEmail} goes through Google Workspace, so your email address and message are held on Google's mail servers.`,
  linkedTo: "We never link it to anyone's tags.",
  kept: "We keep it only to answer you and act on it, and delete it within 90 days after it's resolved. Deleted mail can remain in Google's trash and recovery for up to about 55 days after that.",
};

// Spec §13's "Stays on the phone" list, in the same order.
export const ON_PHONE: readonly { specItem: string; text: string }[] = [
  { specItem: "exact location", text: "your exact location" },
  {
    specItem: "search box text",
    text: "what you type in the search box (to find the place, your phone asks Apple, Google or, on some Android phones, the phone maker's location service, not us)",
  },
  { specItem: "recent searches", text: "your recent searches" },
  { specItem: "favorites", text: "your favorite meetings" },
  { specItem: "sobriety date", text: "your sobriety date" },
  { specItem: "local record of tagged meetings", text: "the list of meetings you've tagged" },
  {
    specItem: "attendance-check results",
    text: "your near-the-meeting check results (only a yes or no is sent, with your tags)",
  },
  { specItem: "cached meetings", text: "meetings saved for use offline" },
  {
    specItem: "all later-phase personal features",
    text: "anything you add in later features, such as notes, a meeting log or a journal",
  },
];

// Spec §13's sentence under the "Stays on the phone" list (owner ruling): the phone's own backups, wherever the person
// sends them, can copy what the app keeps on it, as for most apps. Only the person's backups hold it; our server never
// does.
export const PHONE_BACKUP = {
  specSentence:
    "The phone's own backups (to iCloud, Google, the phone maker's cloud or a computer) may include this data, as they can for most apps. Those backups are the person's, and they never reach our server.",
  text: "Your phone's own backups (to iCloud, Google, your phone maker's cloud or a computer) may include them, as they can for most apps. Those backups are yours, and they never reach our server.",
} as const;

// Spec §2's list of third parties that receive data. specName is the name as SPEC.md writes it.
export const THIRD_PARTIES: readonly { specName: string; name: string; role: string }[] = [
  {
    specName: "Vercel",
    name: "Vercel",
    role: "Hosts this website and the app's server, so it receives every request, including your IP address, and keeps short-term request logs.",
  },
  {
    specName: "Neon",
    name: "Neon",
    role: "Hosts our database, which holds everything listed above, and keeps its restore history.",
  },
  {
    specName: "Apple",
    name: "Apple",
    role: "On iPhone, Apple Maps draws the map and gives directions, Apple's geocoder turns a place you type into a map point, and, once switched on, App Attest and DeviceCheck confirm that requests come from the real app.",
  },
  {
    specName: "Google",
    name: "Google",
    role: "On Android, Google Maps draws the map and gives directions, Android's geocoder turns a place you type into a map point (on some Android phones, the phone maker's location service does this instead), and, once switched on, Play Integrity confirms that requests come from the real app.",
  },
  {
    specName: "Google Workspace",
    name: "Google Workspace",
    role: "Carries and holds the email you send to our support address (see “When you email us”).",
  },
  {
    specName: "the AI provider used for suggestion screening",
    name: "Suggestion screening",
    role: "When you suggest a new tag, only its text (never your phone's ID or location) goes through Vercel's AI Gateway to a screening model, currently OpenAI's gpt-5-nano, with zero data retention: the provider doesn't keep it or train on it.",
  },
];
