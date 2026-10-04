import { Pressable, View } from "react-native";

import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

interface PillProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  // A checkbox toggles a filter or a tag; a radio is one choice of a single-choice group (a meeting's size); a button
  // opens the filter sheet. spokenLabel defaults to label.
  role?: "checkbox" | "radio" | "button";
  spokenLabel?: string;
  hint?: string;
  // Given, the pill opens and closes a panel (PanelToggle): it draws ▾ or ▴ after the label, and says expanded or
  // collapsed instead of selected, the label already saying what's chosen.
  expanded?: boolean;
}

export function Pill({
  label,
  selected,
  onPress,
  role = "checkbox",
  spokenLabel,
  hint,
  expanded,
}: PillProps) {
  const colors = useColors();
  const tone = { color: selected ? colors.accent : colors.text };
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={spokenLabel ?? label}
      accessibilityHint={hint}
      accessibilityState={
        role !== "button" ? { checked: selected } : expanded === undefined ? { selected } : { expanded }
      }
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
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <AppText variant="small" style={tone}>
          {label}
        </AppText>
        {expanded !== undefined && (
          // One glyph, turned over when open: ▴ falls back to another font on iOS and draws larger than ▾.
          <AppText variant="small" style={[tone, expanded && { transform: [{ rotate: "180deg" }] }]}>
            ▾
          </AppText>
        )}
      </View>
    </Pressable>
  );
}
