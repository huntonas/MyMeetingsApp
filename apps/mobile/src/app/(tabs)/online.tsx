import { useUpgradeRequired } from "@/config/upgrade";
import { AppText } from "@/ui/app-text";
import { Screen } from "@/ui/screen";
import { UpgradeNotice } from "@/ui/upgrade-notice";

export default function OnlineScreen() {
  if (useUpgradeRequired()) return <UpgradeNotice />;
  return (
    <Screen>
      <AppText>Online meetings happening now appear here.</AppText>
    </Screen>
  );
}
