import { MAX_TAGS_PER_SUBMISSION, STARTER_VOCABULARY } from "@mymeetingapp/shared";

import { WIDER_SEARCH_RADIUS_KM } from "@/location/geo";
import { radiusMiles } from "@/meetings/units";
import { TAGGING_WINDOW_MS } from "@/tagging/window";

const IN_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const HOUR_MS = 60 * 60 * 1000;

// Labels the app shows that a listing may quote: the Nearby section's heading (went-to-a-meeting.tsx) and the Me
// tab's button (delete-all-my-tags.tsx).
const APP_LABELS = ["Went to a meeting? Tag it", "Delete all my tags"];

const DISCLAIMER =
  "not affiliated with or endorsed by Alcoholics Anonymous, A.A. World Services, Inc., Narcotics Anonymous or NA World Services, Inc.";

// What every store's description must say, and say as the app does. Each store's listing test calls this inside its
// own describe block.
export function describesTheAppAsItIs(description: () => string): void {
  it("says it isn't AA's or NA's, isn't medical advice, and where help is", () => {
    expect(description()).toContain(DISCLAIMER);
    expect(description()).toContain("The app isn't medical advice.");
    expect(description()).toContain("the 988 Suicide & Crisis Lifeline and the SAMHSA National Helpline");
  });

  // Owner decision, 2026-10-05: "recovery meetings", not "AA meetings". The AA and NA names are their World Services'
  // marks, and their Sixth Traditions keep them from lending them to an outside enterprise, so the names appear only in
  // the disclaimer and where the listing says which meetings it lists.
  it("names AA and NA only to say it isn't affiliated, and which meetings it lists", () => {
    const rest = description().replace(DISCLAIMER, "").replace("AA and NA meetings", "");
    expect(rest).not.toMatch(/\bA\.?A\b|Alcoholics Anonymous|\bN\.?A\b|Narcotics Anonymous/);
  });

  // Nearby's "Search farther" goes as far as WIDER_SEARCH_RADIUS_KM, which the app shows as whole miles.
  it("says how far Search farther goes, as the app does", () => {
    expect(description()).toContain(
      `- If nothing is close by, search farther, up to ${String(radiusMiles(WIDER_SEARCH_RADIUS_KM))} miles.`,
    );
  });

  it("says how many words a person can pick, and for how long after a meeting, as the app allows (spec §5)", () => {
    expect(description()).toContain(`pick up to ${String(IN_WORDS[MAX_TAGS_PER_SUBMISSION])} words`);
    expect(description()).toContain(`started in the last ${String(TAGGING_WINDOW_MS / HOUR_MS)} hours`);
  });

  it("quotes only tags from the vocabulary and labels the app shows", () => {
    const quoted = [...description().matchAll(/"([^"]+)"/g)].map(([, phrase]) => phrase);
    const known = [...STARTER_VOCABULARY.map((tag) => tag.label), ...APP_LABELS];
    expect(quoted.length).toBeGreaterThan(0);
    expect(quoted.filter((phrase) => !known.includes(String(phrase)))).toEqual([]);
  });
}
