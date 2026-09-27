import { type AppConfigResponse, SemVer } from "@mymeetingapp/shared";

import { readEnv } from "@/env";

type VersionVar = "MIN_VERSION_IOS" | "MIN_VERSION_ANDROID" | "LATEST_VERSION_IOS" | "LATEST_VERSION_ANDROID";
type FeatureVar = "FEATURE_TAGGING" | "FEATURE_SUGGESTIONS";

// Unset or malformed means "never force an upgrade", so a config mistake can't lock users out.
function version(name: VersionVar): string {
  const value = readEnv(name);
  if (value === undefined) return "0.0.0";
  if (SemVer.safeParse(value).success) return value;
  console.warn(`[config] ${name} is not a version like 1.2.3; using 0.0.0`);
  return "0.0.0";
}

// Features are on when unset or "on". Anything unrecognized switches the feature off, so a mistyped
// "off" during an incident still works.
function enabled(name: FeatureVar): boolean {
  const value = readEnv(name)?.toLowerCase();
  if (value === undefined || value === "on") return true;
  if (value !== "off") console.warn(`[config] ${name} should be "on" or "off"; switching it off`);
  return false;
}

export function readAppConfig(): AppConfigResponse {
  return {
    minSupportedVersion: { ios: version("MIN_VERSION_IOS"), android: version("MIN_VERSION_ANDROID") },
    latestVersion: { ios: version("LATEST_VERSION_IOS"), android: version("LATEST_VERSION_ANDROID") },
    features: { tagging: enabled("FEATURE_TAGGING"), suggestions: enabled("FEATURE_SUGGESTIONS") },
  };
}
