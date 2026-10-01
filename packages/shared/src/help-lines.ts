// Spec §8: the crisis lines the website and the app always show. Safety-critical, so there is one copy of each number,
// read by both. `dial` is what a tel: (or sms:) link carries; `shown` is how the number is written for people.
export const HELP_LINES = [
  {
    name: "988 Suicide & Crisis Lifeline",
    short: "988",
    shown: "988",
    dial: "988",
    texts: true,
    when: "any time",
  },
  {
    name: "SAMHSA National Helpline",
    short: "SAMHSA",
    shown: "1-800-662-4357",
    dial: "18006624357",
    texts: false,
    when: "free and confidential, 24 hours a day",
  },
] as const;

// Alcoholics Anonymous's own meeting finder, offered next to the crisis lines.
export const AA_MEETING_FINDER = "https://www.aa.org/find-aa";
