import { Pressable } from "react-native";

import { useColors } from "@/theme/colors";
import { AppText } from "@/ui/app-text";

interface ButtonProps {
  label: string;
  onPress: () => void;
  // primary: filled; secondary: outlined; text: a link-style action, the accent-coloured label alone (Change place).
  kind?: "primary" | "secondary" | "text";
  // What happens on a press, when the label alone doesn't say (e.g. leaving the app): read after the label.
  hint?: string;
}

// Every tappable control is at least 44 × 44 points and names itself to VoiceOver and TalkBack.
export function Button({ label, onPress, kind = "primary", hint }: ButtonProps) {
  const colors = useColors();
  const primary = kind === "primary";
  const text = kind === "text";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: text ? 0 : 16,
        paddingVertical: 10,
        borderRadius: 8,
        borderWidth: text ? 0 : 1,
        borderColor: colors.accent,
        backgroundColor: primary ? colors.accent : "transparent",
        justifyContent: "center",
        alignItems: "center",
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <AppText variant="label" style={{ color: primary ? colors.accentText : colors.accent }}>
        {label}
      </AppText>
    </Pressable>
  );
}
