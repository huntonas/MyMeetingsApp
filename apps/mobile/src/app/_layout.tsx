import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { pruneCache } from "@/cache/prune";
import { UpgradeProvider } from "@/config/upgrade";
import { VocabularyProvider } from "@/meetings/vocabulary";
import { FiltersProvider } from "@/search/filters";
import { useColors } from "@/theme/colors";
import { FONT } from "@/theme/type";
import { HelpNowButton } from "@/ui/help-now-button";

export default function RootLayout() {
  const colors = useColors();
  useEffect(() => {
    // Best effort, like the cache itself: a copy left behind is only a little more kept on this phone.
    void pruneCache().catch(() => undefined);
  }, []);
  return (
    <UpgradeProvider>
      <VocabularyProvider>
        <FiltersProvider>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.accent,
              headerTitleStyle: { fontFamily: FONT.bold, color: colors.text },
              contentStyle: { backgroundColor: colors.bg },
              // iOS would title the back button with the screen underneath, the tab group's "(tabs)". The arrow alone
              // still reads "Back" to VoiceOver.
              headerBackButtonDisplayMode: "minimal",
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
            <Stack.Screen name="filters" options={{ presentation: "modal", title: "Filters" }} />
            <Stack.Screen name="meeting/[id]" options={{ title: "Meeting" }} />
          </Stack>
        </FiltersProvider>
      </VocabularyProvider>
    </UpgradeProvider>
  );
}
