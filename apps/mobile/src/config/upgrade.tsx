import { AppConfigResponse, isOlderVersion } from "@mymeetingapp/shared";
import { createContext, type ReactNode, useContext } from "react";

import { fetchConfig } from "@/api/reads";
import { useCachedRead } from "@/cache/use-cached-read";
import { appPlatform, appVersion } from "@/config/app-version";

const UpgradeRequired = createContext(false);

const CONFIG_READ = { kind: "config", key: "config", schema: AppConfigResponse, fetch: fetchConfig } as const;

// Owner ruling M3: an installed version this build can't even parse fails open (not required) rather than crashing
// the root provider — the crisis lines must always render, whatever the native build reports.
function isRequired(minimum: string): boolean {
  try {
    return isOlderVersion(appVersion(), minimum);
  } catch {
    return false;
  }
}

// Spec §8: /config is checked at launch. Below the minimum version the app stops searching but keeps what's on the
// phone usable. No config at all (offline on first launch) never blocks.
export function UpgradeProvider({ children }: { children: ReactNode }) {
  const { state } = useCachedRead(CONFIG_READ);
  const required = state.status === "ready" && isRequired(state.data.minSupportedVersion[appPlatform()]);
  return <UpgradeRequired.Provider value={required}>{children}</UpgradeRequired.Provider>;
}

export function useUpgradeRequired(): boolean {
  return useContext(UpgradeRequired);
}
