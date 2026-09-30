import { type Platform as ApiPlatform, SemVer } from "@mymeetingapp/shared";
import { nativeApplicationVersion } from "expo-application";
import { Platform } from "react-native";

// The installed version (app.config.ts `version`, baked into the native build).
export function appVersion(): string {
  const parsed = SemVer.safeParse(nativeApplicationVersion);
  if (!parsed.success) throw new Error("The app's native version isn't a version like 1.2.3");
  return parsed.data;
}

export function appPlatform(): ApiPlatform {
  return Platform.OS === "android" ? "android" : "ios";
}
