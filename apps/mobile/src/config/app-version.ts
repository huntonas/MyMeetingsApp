import { type Platform as ApiPlatform, SemVer } from "@mymeetingapp/shared";
import { nativeApplicationVersion } from "expo-application";
import { Platform } from "react-native";

// The installed version (app.config.ts `version`, baked into the native build), or null when that string doesn't
// parse: a broken build still opens, shows its help lines and keeps the phone's data usable, rather than crashing.
export function installedVersion(): string | null {
  const parsed = SemVer.safeParse(nativeApplicationVersion);
  return parsed.success ? parsed.data : null;
}

export function appPlatform(): ApiPlatform {
  return Platform.OS === "android" ? "android" : "ios";
}
