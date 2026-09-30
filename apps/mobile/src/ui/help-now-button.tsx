import { router } from "expo-router";

import { HeaderButton } from "@/ui/header-button";

export function HelpNowButton() {
  return (
    <HeaderButton
      label="Help"
      accessibilityLabel="Help now: crisis lines"
      onPress={() => {
        router.push("/help");
      }}
    />
  );
}
