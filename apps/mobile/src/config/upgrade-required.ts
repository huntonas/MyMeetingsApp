import { type AppConfigResponse, isOlderVersion, SemVer } from "@mymeetingapp/shared";

import type { ReadState } from "@/cache/use-cached-read";
import { appPlatform } from "@/config/app-version";

// The gate's whole decision, as a pure function: not required unless the read is genuinely "ready", and never
// required when the build's own version is unknown (null, from installedVersion) or unparseable (owner ruling M3):
// fail open rather than crash.
// Its own module so the decision table can pin it directly; UpgradeProvider is its only production caller.
export function upgradeRequired(state: ReadState<AppConfigResponse>, installed: string | null): boolean {
  if (state.status !== "ready" || installed === null) return false;
  const parsed = SemVer.safeParse(installed);
  if (!parsed.success) return false;
  return isOlderVersion(parsed.data, state.data.minSupportedVersion[appPlatform()]);
}
