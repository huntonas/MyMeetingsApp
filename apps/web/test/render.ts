import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#x27;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

// Undoes the escaping React applies to text and attribute values, in one pass so "&amp;lt;" stays "&lt;".
export function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|quot|#x27|lt|gt);/g, (entity) => ENTITIES[entity] ?? entity);
}

// A server component's visible text as the browser first gets it: tags removed, entities decoded, whitespace
// collapsed. Assertions on wording use this, so they don't depend on markup or on how React escapes quotes.
export function renderText(element: ReactElement): string {
  return decodeEntities(renderToStaticMarkup(element).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}
