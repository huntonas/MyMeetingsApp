import { serverUrl } from "@/config/server-url";
import { AppText } from "@/ui/app-text";
import { HandOffButton } from "@/ui/hand-off-button";
import { HelpResources } from "@/ui/help-resources";
import { Screen } from "@/ui/screen";

// Until Phase 6 has store IDs, "Update the app" opens the website, whose store buttons lead to the listing.
export function UpgradeNotice() {
  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">
        Please update mymeetingapp
      </AppText>
      <AppText>
        This version is too old to find meetings. Your saved meetings, sobriety counter and help numbers still
        work.
      </AppText>
      <HandOffButton to="web" label="Update the app" url={`${serverUrl()}/`} />
      <HelpResources />
    </Screen>
  );
}
