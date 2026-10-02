import type { Ref } from "react";
import { Text, type TextProps } from "react-native";

import { useColors } from "@/theme/colors";
import { MAX_FONT_SCALE, TEXT_STYLES, type TextVariant } from "@/theme/type";

interface AppTextProps extends Omit<TextProps, "maxFontSizeMultiplier"> {
  variant?: TextVariant;
  tone?: "text" | "muted" | "accent";
  // For moving screen-reader focus here (moveFocus).
  ref?: Ref<Text>;
}

export function AppText({ variant = "body", tone = "text", style, ...props }: AppTextProps) {
  const colors = useColors();
  return (
    <Text
      {...props}
      maxFontSizeMultiplier={MAX_FONT_SCALE[variant]}
      style={[TEXT_STYLES[variant], { color: colors[tone] }, style]}
    />
  );
}
