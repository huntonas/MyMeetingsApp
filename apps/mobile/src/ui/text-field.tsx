import { TextInput, type TextInputProps } from "react-native";

import { useColors } from "@/theme/colors";
import { TEXT_STYLES } from "@/theme/type";

// Every box the person types into: body text in the theme's colours, at least 44 points tall, named to VoiceOver and
// TalkBack by its accessibilityLabel.
export function TextField(
  props: Omit<TextInputProps, "style" | "placeholderTextColor"> & { accessibilityLabel: string },
) {
  const colors = useColors();
  return (
    <TextInput
      {...props}
      placeholderTextColor={colors.muted}
      style={[
        TEXT_STYLES.body,
        {
          minHeight: 44,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 8,
          paddingHorizontal: 12,
          color: colors.text,
          backgroundColor: colors.surface,
        },
      ]}
    />
  );
}
