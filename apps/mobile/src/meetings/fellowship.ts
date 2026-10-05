import { FELLOWSHIPS, type Fellowship } from "@mymeetingapp/shared";

const LABELS: Record<Fellowship, string> = { aa: "AA", na: "NA" };

function isKnown(slug: string): slug is Fellowship {
  return FELLOWSHIPS.some((known) => known === slug);
}

// /api/v2's fellowships are open-ended: one this build doesn't know shows as its slug, in capitals.
export function fellowshipLabel(slug: string): string {
  return isKnown(slug) ? LABELS[slug] : slug.toUpperCase();
}
