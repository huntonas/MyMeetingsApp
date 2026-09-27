import type { RegistryEntry } from "@mymeetingapp/feed-kit";
import { parse, type HTMLElement } from "node-html-parser";

export interface DirectoryEntity {
  id: string;
  name: string;
  entityType: RegistryEntry["entity_type"];
  state: string;
  website: string | null;
  notes: string;
}

const TYPE_RULES: { pattern: RegExp; type: RegistryEntry["entity_type"] }[] = [
  { pattern: /\bintergroup\b|\bintergrupo\b/i, type: "intergroup" },
  { pattern: /central (office|service)|oficina central|service office/i, type: "central_office" },
  { pattern: /\bdistri(ct|to)\b/i, type: "district" },
];

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

function website(href: string | undefined): string | null {
  if (href === undefined || !/^https?:\/\//i.test(href.trim())) return null;
  try {
    const url = new URL(href.trim());
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

function entity(
  id: string,
  name: string,
  state: string,
  href: string | undefined,
  forcedType?: RegistryEntry["entity_type"],
): DirectoryEntity {
  const rule = TYPE_RULES.find(({ pattern }) => pattern.test(name));
  const site = website(href);
  const notes = [
    site === null ? "no website listed" : "",
    forcedType === undefined && rule === undefined ? "type inferred" : "",
  ]
    .filter((note) => note !== "")
    .join("; ");
  return {
    id,
    name,
    entityType: forcedType ?? rule?.type ?? "intergroup",
    state,
    website: site,
    notes,
  };
}

// A real aa.org state page renders the full worldwide directory (and, on the "All" page, Canada's too)
// in the same `.area-loc-item`/`.related-areas` markup as the requested state, outside this wrapper —
// the page filters to one state/country client-side via tabs. Only `.view-display-id-us` holds the
// entities for a US `state=` page; scope there when it's present, and fall back to the whole document
// for markup (including this parser's own test fixtures) that doesn't have that wrapper.
function usScope(root: HTMLElement): HTMLElement {
  return root.querySelector(".view-display-id-us") ?? root;
}

// Two items that still produce the same id on ONE page (same name, city and state, or the same area
// name twice) get the id suffixed -2, -3, ... in page order, rather than silently colliding.
function dedupeIds(entities: DirectoryEntity[]): DirectoryEntity[] {
  const seen = new Map<string, number>();
  return entities.map((found) => {
    const count = (seen.get(found.id) ?? 0) + 1;
    seen.set(found.id, count);
    return count === 1 ? found : { ...found, id: `${found.id}-${String(count)}` };
  });
}

// One aa.org "Find A.A. Near You" state page: listed offices plus the General Service areas in its footer.
export function parseDirectoryPage(html: string, stateCode: string): DirectoryEntity[] {
  const scope = usScope(parse(html));
  const offices = scope.querySelectorAll(".area-loc-item").map((item) => {
    const name = item.querySelector("h3")?.text.trim() ?? "";
    // The office's city is the first comma-separated part of its address, e.g. "Chittenden County ,
    // Vermont" -> "Chittenden County". Qualifying the id by city (as well as state) keeps same-named
    // offices in different cities distinct.
    const city = item.querySelector("address")?.text.split(",")[0]?.trim() ?? "";
    const id = city === "" ? entityId(name, stateCode) : entityId(name, city, stateCode);
    return entity(id, name, stateCode, item.querySelector("p a")?.getAttribute("href"));
  });
  // Each `.related-areas` block can hold several areas (one `.area-wrapper` per area on the real page):
  // pair its h4s with the links that follow them, in document order. Areas id by name alone (no city or
  // state): area names are unique nationwide, and the same area repeats verbatim across every state
  // page it's related to, so its id must collapse to one value across pages.
  const areas = scope.querySelectorAll(".related-areas").flatMap((block) => {
    const names = block.querySelectorAll("h4");
    const links = block.querySelectorAll("a");
    return names.map((h4, index) => {
      const name = h4.text.trim();
      return entity(entityId(name), name, stateCode, links[index]?.getAttribute("href"), "area");
    });
  });
  return dedupeIds([...offices, ...areas].filter((found) => found.name !== ""));
}
