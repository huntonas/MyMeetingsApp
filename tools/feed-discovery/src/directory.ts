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
  { pattern: /\bintergrou?po?\b|\bintergroup\b/i, type: "intergroup" },
  { pattern: /central (office|service)|oficina central|service office/i, type: "central_office" },
  { pattern: /\bdistri(ct|to)\b/i, type: "district" },
];

export function entityId(name: string, state: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug}-${state.toLowerCase()}`;
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
    id: entityId(name, state),
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

// One aa.org "Find A.A. Near You" state page: listed offices plus the General Service areas in its footer.
export function parseDirectoryPage(html: string, stateCode: string): DirectoryEntity[] {
  const scope = usScope(parse(html));
  const offices = scope
    .querySelectorAll(".area-loc-item")
    .map((item) =>
      entity(
        item.querySelector("h3")?.text.trim() ?? "",
        stateCode,
        item.querySelector("p a")?.getAttribute("href"),
      ),
    );
  // Each `.related-areas` block can hold several areas (one `.area-wrapper` per area on the real page):
  // pair its h4s with the links that follow them, in document order.
  const areas = scope.querySelectorAll(".related-areas").flatMap((block) => {
    const names = block.querySelectorAll("h4");
    const links = block.querySelectorAll("a");
    return names.map((h4, index) =>
      entity(h4.text.trim(), stateCode, links[index]?.getAttribute("href"), "area"),
    );
  });
  return [...offices, ...areas].filter((found) => found.name !== "");
}
