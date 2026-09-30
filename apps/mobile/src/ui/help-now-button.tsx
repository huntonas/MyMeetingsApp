import { router } from "expo-router";
import { Pressable } from "react-native";

import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

export function HelpNowButton() {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Help now: crisis lines"
      onPress={() => {
        router.push("/help");
      }}
      style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 12, justifyContent: "center" }}
    >
      <AppText variant="label" style={{ color: colors.accent }}>
        Help
      </AppText>
    </Pressable>
  );
}
