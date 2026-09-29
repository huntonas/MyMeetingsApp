import { RETENTION } from "@/server/retention";

interface InventoryEntry {
  // The row's name in SPEC.md §13's stored-data table, without backticks.
  specRow: string;
  // The table that holds it, or null for data we never store.
  table: string | null;
  title: string;
  what: string;
  linkedTo: string;
  kept: string;
}

// Spec §13 in plain words, one entry per row. The privacy policy renders this, and privacy-policy.test.tsx fails when
// it drifts from SPEC.md or the database schema. Periods come from RETENTION, which the code enforcing them reads.
export const DATA_INVENTORY: readonly InventoryEntry[] = [
  {
    specRow: "devices",
    table: "devices",
    title: "Your phone's record",
    what: "A keyed hash of the app's ID for your phone (never the ID itself), whether it's an iPhone or an Android phone, the first and last day the app contacted us (dates only), whether we've blocked it for spam and, once app checks are switched on, the app's attestation key.",
    linkedTo: "Nothing else. It doesn't mention any meeting.",
    kept: `Until you use “Delete all my tags”, or ${String(RETENTION.inactiveDeviceMonths)} months after the app last contacted us. If we blocked your phone for spam, we keep its hash, platform, dates and blocked flag even after “Delete all my tags”, so the block stays in place. That record still isn't linked to any meeting.`,
  },
  {
    specRow: "tag_submissions",
    table: "tag_submissions",
    title: "Your tags on a meeting",
    what: "The tags you chose for one meeting, whether the app confirmed you were near it (yes or no, never where you were) and the dates. They're stored under an ID made for that meeting alone, so your tags on two meetings can't be connected to each other.",
    linkedTo: "That one meeting.",
    kept: `Until you change or remove them. The counts in the app only include tags confirmed in the last ${String(RETENTION.countWindowDays)} days.`,
  },
  {
    specRow: "tag_counts",
    table: "tag_counts",
    title: "Tag counts",
    what: "For each meeting and tag, how many phones chose it and how many of those were near the meeting.",
    linkedTo: "One meeting.",
    kept: "Rebuilt every time tags change, and every night.",
  },
  {
    specRow: "tag_audit",
    table: "tag_audit",
    title: "Abuse-review log",
    what: "Your phone's hash, a meeting, whether you added or changed tags, and when.",
    linkedTo:
      "Your phone and one meeting. This is the only place we connect a phone to a meeting, so we can find and block spam.",
    kept: `${String(RETENTION.auditDays)} days, then deleted.`,
  },
  {
    specRow: "tag_swings",
    table: "tag_swings",
    title: "Spam flags",
    what: "When one tag suddenly gains many new phones on a meeting: the meeting, the tag, how many new and earlier phones, and when we flagged and reviewed it.",
    linkedTo: "One meeting. No phone.",
    kept: "Kept.",
  },
  {
    specRow: "meeting_aliases",
    table: "meeting_aliases",
    title: "Merged meetings",
    what: "When two listings turn out to be the same meeting, the old meeting ID and the one it became.",
    linkedTo: "Meetings only.",
    kept: "Kept.",
  },
  {
    specRow: "rate_limits",
    table: "rate_limits",
    title: "Daily limits",
    what: "Your phone's hash, which daily limit it counts (new tags or suggestions), the day (UTC) and how many you've used that day.",
    linkedTo: "Your phone only.",
    kept: `${String(RETENTION.rateLimitDays)} days: today's and yesterday's counts (UTC) are kept, older ones deleted.`,
  },
  {
    specRow: "suggestions",
    table: "suggestions",
    title: "Suggested tags",
    what: "The word or phrase you suggested, and whether we added it, merged it into an existing tag or turned it down. Until we review it, it's also linked to your phone's hash.",
    linkedTo: "Your phone, but only until review.",
    kept: `The text is kept. The link to your phone goes when we review the suggestion or after ${String(RETENTION.suggestionLinkDays)} days, whichever comes first. “Delete all my tags” deletes any suggestion still linked to you.`,
  },
  {
    specRow: "ai_decisions",
    table: "ai_decisions",
    title: "Suggestion screening log",
    what: "The suggested text, what the screening model decided (merge it into an existing tag, reject it or leave it for a person), which tag it named for a merge, its reason, the model's name and the time.",
    linkedTo: `One suggestion, and through it your phone for at most ${String(RETENTION.suggestionLinkDays)} days.`,
    kept: "Kept, including the suggestion's text. “Delete all my tags” deletes it together with a suggestion still linked to you.",
  },
  {
    specRow: "Search request",
    table: null,
    title: "Search location",
    what: "When you search, the app rounds the location to about 1 km (two decimal places) and sends it in the body of the request, never in a web address.",
    linkedTo: "Nothing.",
    kept: "Not stored. It's used for that one search and never written to a log.",
  },
  {
    specRow: "Vercel request logs",
    table: null,
    title: "Hosting request logs",
    what: "Our host, Vercel, records each request's IP address, the page or API path, and the time.",
    linkedTo: "Nothing we control. We never add request contents, headers or locations to these logs.",
    kept: "For the short time Vercel's plan keeps them. We don't copy them anywhere.",
  },
];

// Spec §13's "Stays on the phone" list, in the same order.
export const ON_PHONE: readonly { specItem: string; text: string }[] = [
  { specItem: "exact location", text: "your exact location" },
  { specItem: "search box text", text: "what you type in the search box" },
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
    role: "On Android, Google Maps draws the map and gives directions, Android's geocoder turns a place you type into a map point, and, once switched on, Play Integrity confirms that requests come from the real app.",
  },
  {
    specName: "the AI provider used for suggestion screening",
    name: "Suggestion screening",
    role: "When you suggest a new tag, only its text (never your phone's ID or location) goes through Vercel's AI Gateway to a screening model, currently OpenAI's gpt-5-nano, with zero data retention: the provider doesn't keep it or train on it.",
  },
];
