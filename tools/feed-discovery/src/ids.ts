// Slugs the name and every qualifier, joining them in order. Offices pass a city and a state so
// same-named offices in different cities stay distinct; footer areas pass no qualifiers at all, since
// area names are unique nationwide and the same area repeats verbatim across every state page it's
// related to. A qualifier with no text (e.g. an office with a blank address) is skipped.
export function entityId(name: string, ...qualifiers: string[]): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  return [name, ...qualifiers]
    .map(slug)
    .filter((segment) => segment !== "")
    .join("-");
}
