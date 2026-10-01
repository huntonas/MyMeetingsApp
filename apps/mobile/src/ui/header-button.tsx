import { Pressable } from "react-native";

import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

interface HeaderButtonProps {
  label: string;
  onPress: () => void;
  // What VoiceOver and TalkBack read, when the short label shown in the header doesn't say enough.
  accessibilityLabel?: string;
}

// A header control, not a <Button>: it sits inline in the native header bar, at the header's own size and spacing,
// not the screen-content button style. Still at least 44 × 44 points.
export function HeaderButton({ label, onPress, accessibilityLabel = label }: HeaderButtonProps) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 12, justifyContent: "center" }}
    >
      <AppText variant="label" style={{ color: colors.accent }}>
        {label}
      </AppText>
    </Pressable>
  );
}
