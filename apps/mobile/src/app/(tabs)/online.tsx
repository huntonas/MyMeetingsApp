import { useUpgradeRequired } from "@/config/upgrade";
import { OnlineNowList } from "@/ui/online-now-list";
import { Screen } from "@/ui/screen";
import { UpgradeNotice } from "@/ui/upgrade-notice";

export default function OnlineScreen() {
  if (useUpgradeRequired()) return <UpgradeNotice />;
  return (
    <Screen>
      <OnlineNowList />
    </Screen>
  );
}
