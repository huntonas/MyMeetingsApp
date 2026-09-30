import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { useColors } from "@/theme/colors";

// One left-aligned column with the website's 20-point gutter.
export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const colors = useColors();
  const style = { backgroundColor: colors.bg };
  const content = { padding: 20, gap: 16 };
  if (!scroll) return <View style={[style, content, { flex: 1 }]}>{children}</View>;
  return (
    <ScrollView style={style} contentContainerStyle={content}>
      {children}
    </ScrollView>
  );
}
