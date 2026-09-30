import { Pressable } from "react-native";

import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

interface PillProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  // A checkbox toggles a filter; a button opens the filter sheet. spokenLabel defaults to label.
  role?: "checkbox" | "button";
  spokenLabel?: string;
}

export function Pill({ label, selected, onPress, role = "checkbox", spokenLabel }: PillProps) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={spokenLabel ?? label}
      accessibilityState={role === "checkbox" ? { checked: selected } : { selected }}
      onPress={onPress}
      style={{
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: 14,
        justifyContent: "center",
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.line,
        backgroundColor: selected ? colors.tagBg : colors.surface,
      }}
    >
      <AppText variant="small" style={{ color: selected ? colors.accent : colors.text }}>
        {label}
      </AppText>
    </Pressable>
  );
}
