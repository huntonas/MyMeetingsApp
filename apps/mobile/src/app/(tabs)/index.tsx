import { useUpgradeRequired } from "@/config/upgrade";
import { AppText } from "@/ui/app-text";
import { Screen } from "@/ui/screen";
import { UpgradeNotice } from "@/ui/upgrade-notice";

export default function NearbyScreen() {
  if (useUpgradeRequired()) return <UpgradeNotice />;
  return (
    <Screen>
      <AppText>Search by city, zip code or address, or use your location.</AppText>
    </Screen>
  );
}
