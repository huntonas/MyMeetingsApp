import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router/js-tabs";

import { useColors } from "@/theme/colors";
import { FONT } from "@/theme/type";
import { AppText } from "@/ui/app-text";
import { HelpNowButton } from "@/ui/help-now-button";

// The owner's design: Nearby, Online, Saved, Me.
const TABS = [
  { name: "index", title: "Nearby", icon: "location-outline" },
  { name: "online", title: "Online", icon: "videocam-outline" },
  { name: "saved", title: "Saved", icon: "heart-outline" },
  { name: "me", title: "Me", icon: "person-outline" },
] as const;

export default function TabsLayout() {
  const colors = useColors();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        // The header bar keeps its height, so its title is the header's own capped words, not react-navigation's.
        headerTitle: ({ children }) => (
          <AppText variant="header" accessibilityRole="header" numberOfLines={1}>
            {children}
          </AppText>
        ),
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: FONT.regular, fontSize: 13 },
        headerRight: () => <HelpNowButton />,
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarAccessibilityLabel: tab.title,
            tabBarIcon: ({ color, size }) => <Ionicons name={tab.icon} color={color} size={size} />,
          }}
        />
      ))}
    </Tabs>
  );
}
