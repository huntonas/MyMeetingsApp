import { View } from "react-native";

import { AppText } from "@/ui/app-text";
import { HandOffButton } from "@/ui/hand-off-button";

// Spec §8: 988 and the SAMHSA National Helpline are always reachable, in the website's words
// (apps/web/src/components/help-resources.tsx).
const LINES = [
  {
    name: "988 Suicide & Crisis Lifeline",
    detail: "Call or text 988, any time.",
    actions: [
      { label: "Call 988", url: "tel:988", to: "phone" },
      { label: "Text 988", url: "sms:988", to: "messages" },
    ],
  },
  {
    name: "SAMHSA National Helpline",
    detail: "1-800-662-4357, free and confidential, 24 hours a day.",
    actions: [{ label: "Call SAMHSA", url: "tel:18006624357", to: "phone" }],
  },
] as const;

export function HelpResources() {
  return (
    <View style={{ gap: 16 }}>
      <AppText variant="heading" accessibilityRole="header">
        Need help now?
      </AppText>
      {LINES.map((line) => (
        <View key={line.name} style={{ gap: 8 }}>
          <AppText variant="label">{line.name}</AppText>
          <AppText>{line.detail}</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {line.actions.map((action) => (
              <HandOffButton key={action.label} to={action.to} label={action.label} url={action.url} />
            ))}
          </View>
        </View>
      ))}
      <AppText>Alcoholics Anonymous has its own meeting finder at aa.org.</AppText>
      <HandOffButton
        to="web"
        kind="secondary"
        label="Open aa.org's meeting finder"
        url="https://www.aa.org/find-aa"
      />
    </View>
  );
}
