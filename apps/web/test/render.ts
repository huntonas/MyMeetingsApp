import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A server component's visible text as the browser first gets it: tags removed, entities decoded, whitespace
// collapsed. Assertions on wording use this, so they don't depend on markup or on how React escapes quotes.
export function renderText(element: ReactElement): string {
  return renderToStaticMarkup(element)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
