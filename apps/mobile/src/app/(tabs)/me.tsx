import { View } from "react-native";

import { installedVersion } from "@/config/app-version";
import { serverUrl } from "@/config/server-url";
import { AppText } from "@/ui/app-text";
import { DeleteAllMyTags } from "@/ui/delete-all-my-tags";
import { HandOffButton } from "@/ui/hand-off-button";
import { HelpResources } from "@/ui/help-resources";
import { Screen } from "@/ui/screen";
import { SobrietyCard } from "@/ui/sobriety-card";

// The website's pages, which the stores link to as well (spec §11).
const PAGES = [
  { label: "Privacy policy", path: "/privacy" },
  { label: "Support", path: "/support" },
  { label: "Terms of use", path: "/terms" },
] as const;

// Spec §8's settings: sobriety date, delete all my tags, help resources, the website's pages and the app's version.
// The app never shows its device ID (owner decision, 2026-09-29).
export default function MeScreen() {
  const version = installedVersion();
  return (
    <Screen>
      <SobrietyCard />
      <View style={{ gap: 8 }}>
        <AppText variant="heading" accessibilityRole="header">
          Your tags
        </AppText>
        <DeleteAllMyTags />
      </View>
      <HelpResources />
      <View style={{ gap: 8 }}>
        <AppText variant="heading" accessibilityRole="header">
          About
        </AppText>
        {PAGES.map((page) => (
          <HandOffButton
            key={page.path}
            to="web"
            kind="secondary"
            label={page.label}
            url={`${serverUrl()}${page.path}`}
          />
        ))}
        {version !== null && <AppText tone="muted">{`Version ${version}`}</AppText>}
      </View>
    </Screen>
  );
}
