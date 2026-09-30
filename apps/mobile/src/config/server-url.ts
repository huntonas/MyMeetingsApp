// The one origin the app talks to: the website and its API. eas.json sets it per build profile, and .env sets it for
// local runs. Missing or malformed throws, so a build never talks to a server nobody chose. Expo inlines
// process.env.EXPO_PUBLIC_* at build time only when it is read exactly like this.
//
// expo-modules-core's global augmentation widens NodeJS.ProcessEnv with a `[key: string]: any` index signature, so
// an unlisted key reads as `any`; the `typeof` check below is the runtime check that narrows it back to a string.
export function serverUrl(): string {
  const raw: unknown = process.env.EXPO_PUBLIC_SERVER_URL;
  const value = typeof raw === "string" ? raw.replace(/\/$/, "") : undefined;
  if (value === undefined || !/^https?:\/\/[^/]+$/.test(value)) {
    throw new Error(
      "EXPO_PUBLIC_SERVER_URL must be an http(s) origin such as https://mymeetingapp.vercel.app",
    );
  }
  return value;
}
