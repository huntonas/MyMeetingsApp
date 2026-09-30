import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { AccessibilityInfo, View } from "react-native";

import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";

interface ConfirmButtonProps {
  // The first button, and what a screen reader says it does ("Asks before …").
  label: string;
  hint: string;
  // Asked in place of the button after the first tap, then answered with `confirmLabel` or `cancelLabel`.
  question: string;
  confirmLabel: string;
  confirmHint: string;
  cancelLabel: string;
  onConfirm: () => void;
}

// The one way to do something destructive in the app: an inline two-step confirm, never a native Alert. The first tap
// swaps the button for the question (announced to VoiceOver and TalkBack) and its two answers; leaving the screen
// forgets that it asked.
export function ConfirmButton({
  label,
  hint,
  question,
  confirmLabel,
  confirmHint,
  cancelLabel,
  onConfirm,
}: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false);
  useFocusEffect(
    useCallback(
      () => () => {
        setAsking(false);
      },
      [],
    ),
  );
  if (!asking) {
    return (
      <Button
        kind="secondary"
        label={label}
        hint={hint}
        onPress={() => {
          setAsking(true);
          AccessibilityInfo.announceForAccessibility(question);
        }}
      />
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="label">{question}</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button
          label={confirmLabel}
          hint={confirmHint}
          onPress={() => {
            setAsking(false);
            onConfirm();
          }}
        />
        <Button
          kind="secondary"
          label={cancelLabel}
          onPress={() => {
            setAsking(false);
          }}
        />
      </View>
    </View>
  );
}
