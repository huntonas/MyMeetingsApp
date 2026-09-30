import { AppConfigResponse } from "@mymeetingapp/shared";
import { createContext, type ReactNode, useContext } from "react";

import { fetchConfig } from "@/api/reads";
import { useCachedRead } from "@/cache/use-cached-read";
import { installedVersion } from "@/config/app-version";
import { upgradeRequired } from "@/config/upgrade-required";

const UpgradeRequired = createContext(false);

const CONFIG_READ = { kind: "config", key: "config", schema: AppConfigResponse, fetch: fetchConfig } as const;

// Spec §8: /config is checked at launch. Below the minimum version the app stops searching but keeps what's on the
// phone usable. No config at all (offline on first launch) never blocks.
export function UpgradeProvider({ children }: { children: ReactNode }) {
  const { state } = useCachedRead(CONFIG_READ);
  // An unreadable version becomes "", which upgradeRequired fails open on, as on any other bad version.
  const required = upgradeRequired(state, installedVersion() ?? "");
  return <UpgradeRequired.Provider value={required}>{children}</UpgradeRequired.Provider>;
}

export function useUpgradeRequired(): boolean {
  return useContext(UpgradeRequired);
}
