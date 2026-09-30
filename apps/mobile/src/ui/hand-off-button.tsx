import { useState } from "react";
import { Linking, View } from "react-native";

import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";

// Where each hand-off goes: what a screen reader says it does, and what to say if the phone can't open it (no maps
// or phone app, a tablet without calling, a link nothing handles). A number is always shown above its button.
const HAND_OFFS = {
  maps: { hint: "Opens Maps", failure: "This phone couldn't open Maps." },
  phone: {
    hint: "Opens your phone app",
    failure: "This phone couldn't start a call. The number is shown above.",
  },
  messages: {
    hint: "Opens your messages app",
    failure: "This phone couldn't open messages. The number is shown above.",
  },
  web: { hint: "Opens in your browser", failure: "This phone couldn't open that link." },
} as const;

type HandOff = keyof typeof HAND_OFFS;

// The one way the app leaves for another app. `url` is only ever a fixed address, a directionsUrl, a `tel:` built by
// dialable, or a server URL that passed the shared WebUrl schema (http or https).
export function HandOffButton({
  to,
  label,
  url,
  kind,
}: {
  to: HandOff;
  label: string;
  url: string;
  kind?: "primary" | "secondary";
}) {
  const [failed, setFailed] = useState(false);
  const { hint, failure } = HAND_OFFS[to];
  return (
    <View style={{ gap: 4 }}>
      <Button
        kind={kind}
        label={label}
        hint={hint}
        onPress={() => {
          setFailed(false);
          Linking.openURL(url).catch(() => {
            setFailed(true);
          });
        }}
      />
      {failed && (
        <AppText variant="small" accessibilityRole="alert">
          {failure}
        </AppText>
      )}
    </View>
  );
}
