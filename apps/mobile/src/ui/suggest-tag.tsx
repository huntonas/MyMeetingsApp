import { BRAND, TagLabelText } from "@mymeetingapp/shared";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, type Text, View } from "react-native";

import { failureMessage } from "@/api/failure-message";
import { suggestTag } from "@/api/writes";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { moveFocus } from "@/ui/move-focus";
import { useNotice } from "@/ui/notice";
import { TextField } from "@/ui/text-field";

const THANKS = "Thanks. We'll review it, and if it's added, it'll appear in the list for everyone.";
const NOT_A_TAG =
  "Use 2 to 40 letters or numbers, starting with a letter or number (spaces, apostrophes, hyphens and & are fine).";
// A suggestion that timed out may still have reached the server, so this can't say it didn't arrive.
const OFFLINE_SUGGESTION = `We couldn't reach ${BRAND.name}, so we can't tell whether your suggestion arrived. Try again.`;

// Spec §5: a new word for the tag list, checked on the phone with the server's own rule before it's sent. The server
// screens it and never says what it decided, so a suggestion that went through only ever gets a thank-you. The words
// live in this component's state alone: never saved, never logged.
export function SuggestTag() {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const result = useNotice();
  const helper = useRef<Text>(null);
  // Opened in place, so VoiceOver and TalkBack start at what it asks rather than the button it replaced.
  useEffect(() => {
    if (writing) moveFocus(helper);
  }, [writing]);
  if (!writing) {
    return (
      <Button
        kind="text"
        label="Suggest a tag"
        hint="Suggest a word that isn't in the list"
        onPress={() => {
          setWriting(true);
        }}
      />
    );
  }
  const send = () => {
    // So what it says next isn't under the keyboard.
    Keyboard.dismiss();
    if (!TagLabelText.safeParse(text).success) {
      result.tell(NOT_A_TAG);
      return;
    }
    setSending(true);
    result.tell(null);
    suggestTag(text)
      .then(
        () => {
          setText("");
          result.tell(THANKS);
        },
        (error: unknown) => {
          result.tell(failureMessage(error, OFFLINE_SUGGESTION));
        },
      )
      .finally(() => {
        setSending(false);
      });
  };
  return (
    <View style={{ gap: 8 }}>
      <AppText ref={helper} tone="muted">
        We review every suggestion. Don't include names or anything that could identify someone.
      </AppText>
      {/* Side by side: the page scrolls the focused field above the keyboard, and Send with it (under the field, Send
      would stay covered). The field keeps room for a readable word or two at the largest text size. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 160 }}>
          <TextField
            accessibilityLabel="Your suggested tag"
            accessibilityHint="2 to 40 letters or numbers"
            editable={!sending}
            value={text}
            onChangeText={setText}
            maxLength={60}
            autoCorrect={false}
            onSubmitEditing={send}
            returnKeyType="send"
          />
        </View>
        {sending ? (
          <ActivityIndicator accessibilityLabel="Sending your suggestion" />
        ) : (
          <Button label="Send" hint={`Sends only these words to ${BRAND.name}`} onPress={send} />
        )}
      </View>
      {result.text !== null && <AppText accessibilityRole="alert">{result.text}</AppText>}
    </View>
  );
}
