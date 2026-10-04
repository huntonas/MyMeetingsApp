import { BRAND } from "@mymeetingapp/shared";

// The live site's hosts, which only store builds may talk to (in any case, over either scheme): its domain, and
// Vercel's own address for the production project, which still serves it.
const PRODUCTION_HOSTS: readonly string[] = [BRAND.domain, "mymeetingapp.vercel.app"];

// The one origin the app talks to: the website and its API. A dev build takes it from apps/mobile/.env (Metro inlines
// it into the bundle); a store build from its eas.json profile. Missing or malformed throws, so a build never talks
// to a server nobody chose. Expo inlines process.env.EXPO_PUBLIC_* at build time only when it is read exactly like
// this.
//
// expo-modules-core's global augmentation widens NodeJS.ProcessEnv with a `[key: string]: any` index signature, so
// an unlisted key reads as `any`; the `typeof` check below is the runtime check that narrows it back to a string.
export function serverUrl(): string {
  const raw: unknown = process.env.EXPO_PUBLIC_SERVER_URL;
  const value = typeof raw === "string" ? raw.replace(/\/$/, "") : undefined;
  if (value === undefined || !/^https?:\/\/[^/]+$/i.test(value)) {
    throw new Error(
      "EXPO_PUBLIC_SERVER_URL must be an http(s) origin such as https://mymeetingapp-staging.vercel.app",
    );
  }
  // Dev builds add and delete tags, which must never reach the live counts.
  if (__DEV__ && PRODUCTION_HOSTS.includes(value.replace(/^https?:\/\//i, "").toLowerCase())) {
    throw new Error(
      "A dev build never talks to production (it adds and deletes tags). Set EXPO_PUBLIC_SERVER_URL in apps/mobile/.env to https://mymeetingapp-staging.vercel.app or your Mac's LAN address.",
    );
  }
  return value;
}
