import { AA_MEETING_FINDER, HELP_LINES } from "@mymeetingapp/shared";
import { View } from "react-native";

import { AppText } from "@/ui/app-text";
import { HandOffButton } from "@/ui/hand-off-button";

// Spec §8: 988 and the SAMHSA National Helpline are always reachable, in the website's words (HELP_LINES).
export function HelpResources() {
  return (
    <View style={{ gap: 16 }}>
      <AppText variant="heading" accessibilityRole="header">
        Need help now?
      </AppText>
      {HELP_LINES.map((line) => (
        <View key={line.name} style={{ gap: 8 }}>
          <AppText variant="label">{line.name}</AppText>
          <AppText>{`${line.texts ? "Call or text " : ""}${line.shown}, ${line.when}.`}</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <HandOffButton to="phone" label={`Call ${line.short}`} url={`tel:${line.dial}`} />
            {line.texts && (
              <HandOffButton to="messages" label={`Text ${line.short}`} url={`sms:${line.dial}`} />
            )}
          </View>
        </View>
      ))}
      <AppText>Alcoholics Anonymous has its own meeting finder at aa.org.</AppText>
      <HandOffButton to="web" kind="secondary" label="Open aa.org's meeting finder" url={AA_MEETING_FINDER} />
    </View>
  );
}
