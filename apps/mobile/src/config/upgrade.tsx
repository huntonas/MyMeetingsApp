import { AppConfigResponse } from "@mymeetingapp/shared";
import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";

import { fetchConfig } from "@/api/reads";
import { onReturnToForeground } from "@/app-state/return-to-foreground";
import { useCachedRead } from "@/cache/use-cached-read";
import { installedVersion } from "@/config/app-version";
import { upgradeRequired } from "@/config/upgrade-required";

type Features = AppConfigResponse["features"];

// With no config (offline, or still reading), nothing is hidden: the server still decides each write.
const ALL_ON: Features = { tagging: true, suggestions: true };

const UpgradeRequired = createContext(false);
const FeatureSwitches = createContext<Features>(ALL_ON);

const CONFIG_READ = { kind: "config", key: "config", schema: AppConfigResponse, fetch: fetchConfig } as const;

// Spec §8: /config is checked at launch, and again each time the app returns from the background (a phone can stay
// launched for weeks). Below the minimum version the app stops searching but keeps what's on the phone usable. No
// config at all (offline on first launch) never blocks.
export function UpgradeProvider({ children }: { children: ReactNode }) {
  const { state, refresh } = useCachedRead(CONFIG_READ);
  useEffect(() => onReturnToForeground(refresh), [refresh]);
  const required = upgradeRequired(state, installedVersion());
  const features = useMemo(() => (state.status === "ready" ? state.data.features : ALL_ON), [state]);
  return (
    <UpgradeRequired.Provider value={required}>
      <FeatureSwitches.Provider value={features}>{children}</FeatureSwitches.Provider>
    </UpgradeRequired.Provider>
  );
}

export function useUpgradeRequired(): boolean {
  return useContext(UpgradeRequired);
}

// Spec §7's feature switches, as the last config read set them.
export function useFeatures(): Features {
  return useContext(FeatureSwitches);
}
