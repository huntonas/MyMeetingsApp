import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { useColors } from "@/theme/colors";
import { FONT } from "@/theme/type";

export default function RootLayout() {
  const colors = useColors();
  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.accent,
          headerTitleStyle: { fontFamily: FONT.bold, color: colors.text },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
