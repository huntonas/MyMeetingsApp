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
  settings: {
    hint: "Opens this app's settings",
    failure:
      "This phone couldn't open Settings. You can turn location on for mymeetingapp in the Settings app.",
  },
} as const;

type HandOffProps = { label: string; kind?: "primary" | "secondary" } & (
  { to: "settings" } | { to: Exclude<keyof typeof HAND_OFFS, "settings">; url: string }
);

// The one way the app leaves for another app. `url` is only ever a fixed address, a directionsUrl, a `tel:` built by
// dialable, or a server URL that passed the shared WebUrl schema (http or https); "settings" opens this app's own
// page in the phone's Settings, and needs none.
export function HandOffButton(props: HandOffProps) {
  const { label, kind } = props;
  const [failed, setFailed] = useState(false);
  const { hint, failure } = HAND_OFFS[props.to];
  return (
    <View style={{ gap: 4 }}>
      <Button
        kind={kind}
        label={label}
        hint={hint}
        onPress={() => {
          setFailed(false);
          const opening = props.to === "settings" ? Linking.openSettings() : Linking.openURL(props.url);
          opening.catch(() => {
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
