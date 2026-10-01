import { ERROR_MESSAGES, MAX_TAGS_PER_SUBMISSION, TAG_CATEGORIES } from "@mymeetingapp/shared";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, type Text, View } from "react-native";

import { ApiError } from "@/api/client";
import { failureMessage } from "@/api/failure-message";
import { CATEGORY_TITLES, useRefreshVocabulary, useVocabularyTags } from "@/meetings/vocabulary";
import { AppText } from "@/ui/app-text";
import { Button } from "@/ui/button";
import { moveFocus } from "@/ui/move-focus";
import { Pill } from "@/ui/pill";

// A write that timed out may still have reached the server, so this can't say the tags weren't saved.
const OFFLINE_TAGS =
  "We couldn't reach mymeetingapp, so we can't tell whether your tags were saved. Check your connection and try again.";

interface TagPanelProps {
  initial: readonly string[];
  // Sends the chosen tags; throws when they didn't go through, and the panel says why.
  onSubmit: (tags: string[]) => Promise<void>;
  onCancel: () => void;
}

// Spec §8: up to 6 tags, grouped by category, from the tag list the server serves. Writes aren't optimistic: the
// choices stay until the server answers, and a refusal keeps them with the server's own words.
export function TagPanel({ initial, onSubmit, onCancel }: TagPanelProps) {
  const vocabulary = useVocabularyTags();
  const refreshVocabulary = useRefreshVocabulary();
  const [chosen, setChosen] = useState<string[]>([...initial]);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const heading = useRef<Text>(null);
  // Opened in place, so VoiceOver and TalkBack start reading at the picker rather than the button it replaced.
  useEffect(() => {
    moveFocus(heading);
  }, []);
  // A tag retired since it was chosen (the list was read again) is dropped rather than sent.
  const live = chosen.filter((slug) => vocabulary.has(slug));
  const say = (text: string) => {
    setMessage(text);
    AccessibilityInfo.announceForAccessibility(text);
  };
  const toggle = (slug: string) => {
    setMessage(null);
    if (live.includes(slug)) setChosen(live.filter((other) => other !== slug));
    else if (live.length >= MAX_TAGS_PER_SUBMISSION) say(ERROR_MESSAGES.too_many_tags);
    else setChosen([...live, slug]);
  };
  const send = () => {
    if (live.length === 0) {
      say("Choose at least one tag.");
      return;
    }
    setSending(true);
    setMessage(null);
    onSubmit(live)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code === "unknown_tag") refreshVocabulary();
        say(failureMessage(error, OFFLINE_TAGS));
      })
      .finally(() => {
        setSending(false);
      });
  };
  const tags = [...vocabulary.values()];
  return (
    <View style={{ gap: 12 }}>
      <AppText ref={heading} variant="heading" accessibilityRole="header">
        Tag this meeting
      </AppText>
      {tags.length === 0 ? (
        <AppText tone="muted">Tag names haven't loaded yet. They'll appear when you're back online.</AppText>
      ) : (
        <>
          <AppText tone="muted">{`Choose up to ${String(MAX_TAGS_PER_SUBMISSION)} words that describe this meeting.`}</AppText>
          {TAG_CATEGORIES.map((category) => {
            const inCategory = tags.filter((tag) => tag.category === category);
            if (inCategory.length === 0) return null;
            return (
              <View key={category} style={{ gap: 8 }}>
                <AppText variant="label" accessibilityRole="header">
                  {CATEGORY_TITLES[category]}
                </AppText>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {inCategory.map((tag) => (
                    <Pill
                      key={tag.slug}
                      label={tag.label}
                      selected={live.includes(tag.slug)}
                      onPress={() => {
                        toggle(tag.slug);
                      }}
                    />
                  ))}
                </View>
              </View>
            );
          })}
          <AppText>{`${String(live.length)} of ${String(MAX_TAGS_PER_SUBMISSION)} chosen`}</AppText>
        </>
      )}
      {message !== null && <AppText accessibilityRole="alert">{message}</AppText>}
      {sending ? (
        <ActivityIndicator accessibilityLabel="Sending your tags" />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {tags.length > 0 && (
            <Button label="Send my tags" hint="Sends only these tags, for this meeting" onPress={send} />
          )}
          <Button kind="secondary" label="Cancel" onPress={onCancel} />
        </View>
      )}
    </View>
  );
}
