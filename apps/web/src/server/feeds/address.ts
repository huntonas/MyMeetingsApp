const ABBREVIATIONS: Record<string, string> = {
  street: "st",
  avenue: "ave",
  road: "rd",
  drive: "dr",
  boulevard: "blvd",
  lane: "ln",
  court: "ct",
  place: "pl",
  parkway: "pkwy",
  highway: "hwy",
  suite: "ste",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
};

// Two feeds' spellings of one address should produce the same key (spec §3 matching).
export function addressKey(address: string | null): string | null {
  if (address === null) return null;
  const words = address
    .toLowerCase()
    .replace(/\b(usa|united states(?: of america)?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "")
    .map((word) => ABBREVIATIONS[word] ?? word);
  return words.length > 0 ? words.join(" ") : null;
}
