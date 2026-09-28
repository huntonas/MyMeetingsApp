import { createHash } from "node:crypto";

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Slugs the name and every qualifier, joining them in order. Offices pass a city and a state so
// same-named offices in different cities stay distinct; footer areas pass no qualifiers at all, since
// area names are unique nationwide and the same area repeats verbatim across every state page it's
// related to. A qualifier with no text (e.g. an office with a blank address) is skipped. A name with
// no Latin letters or digits slugs to nothing, so a short hash of it stands in: the id is never empty
// and stays the same from run to run.
export function entityId(name: string, ...qualifiers: string[]): string {
  const nameSlug = slug(name) || `entity-${createHash("sha256").update(name).digest("hex").slice(0, 8)}`;
  return [nameSlug, ...qualifiers.map(slug)].filter((segment) => segment !== "").join("-");
}
