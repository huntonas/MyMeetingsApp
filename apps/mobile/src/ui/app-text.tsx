import type { Ref } from "react";
import { Text, type TextProps } from "react-native";

import { useColors } from "@/theme/colors";
import { TEXT_STYLES, type TextVariant } from "@/theme/type";

interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: "text" | "muted" | "accent";
  // For moving screen-reader focus here (moveFocus).
  ref?: Ref<Text>;
}

export function AppText({ variant = "body", tone = "text", style, ...props }: AppTextProps) {
  const colors = useColors();
  return <Text {...props} style={[TEXT_STYLES[variant], { color: colors[tone] }, style]} />;
}
