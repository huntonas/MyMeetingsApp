import { BRAND } from "@mymeetingapp/shared";

// Spec §4 politeness: identifies every outbound request with a contact email.
export const USER_AGENT = `${BRAND.slug}/1.0 (+https://${BRAND.domain}; ${BRAND.contactEmail})`;
