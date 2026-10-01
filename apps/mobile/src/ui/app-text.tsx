import { Text, type TextProps } from "react-native";

import { useColors } from "@/theme/colors";
import { TEXT_STYLES, type TextVariant } from "@/theme/type";

interface AppTextProps extends TextProps {
  variant?: TextVariant;
  tone?: "text" | "muted" | "accent";
}

export function AppText({ variant = "body", tone = "text", style, ...props }: AppTextProps) {
  const colors = useColors();
  return <Text {...props} style={[TEXT_STYLES[variant], { color: colors[tone] }, style]} />;
}
