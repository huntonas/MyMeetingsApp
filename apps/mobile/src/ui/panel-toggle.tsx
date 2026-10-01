import { Pressable, View } from "react-native";

import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

interface PanelToggleProps {
  label: string;
  spokenLabel: string;
  // What the panel holds, for the hint: "Shows the filters", "Hides the filters".
  contents: string;
  expanded: boolean;
  onToggle: () => void;
}

// Opens and closes a panel of controls the screen lays out under it (or over a map). The arrow is only drawn: the
// expanded state says the same to VoiceOver and TalkBack.
export function PanelToggle({ label, spokenLabel, contents, expanded, onToggle }: PanelToggleProps) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spokenLabel}
      accessibilityHint={`${expanded ? "Hides" : "Shows"} ${contents}`}
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={({ pressed }) => ({
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.accent,
        justifyContent: "center",
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <AppText variant="label" tone="accent">
          {label}
        </AppText>
        <AppText variant="label" tone="accent">
          {expanded ? "▲" : "▼"}
        </AppText>
      </View>
    </Pressable>
  );
}
