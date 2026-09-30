import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { UpgradeProvider } from "@/config/upgrade";
import { VocabularyProvider } from "@/meetings/vocabulary";
import { useColors } from "@/theme/colors";
import { FONT } from "@/theme/type";
import { HelpNowButton } from "@/ui/help-now-button";

export default function RootLayout() {
  const colors = useColors();
  return (
    <UpgradeProvider>
      <VocabularyProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.accent,
            headerTitleStyle: { fontFamily: FONT.bold, color: colors.text },
            contentStyle: { backgroundColor: colors.bg },
            // Spec §8: Help is reachable from every screen, including any root-stack screen future tasks add (T8's
            // filters modal, T10's meeting route). Suppressed on the Help screen itself, below.
            headerRight: () => <HelpNowButton />,
          }}
        >
          {/* react-navigation still mounts a hidden screen's header config, so the root headerRight below has to be
          suppressed here too, even though this header never shows: the tabs navigator renders its own (with the
          same button) instead. */}
          <Stack.Screen name="(tabs)" options={{ headerShown: false, headerRight: () => null }} />
          <Stack.Screen
            name="help"
            options={{ presentation: "modal", title: "Help now", headerRight: () => null }}
          />
        </Stack>
      </VocabularyProvider>
    </UpgradeProvider>
  );
}
